import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { parseFrontmatterDocument } from '@treeseed/sdk/frontmatter';
import { reconcileTarget, type ReconcileSelector } from '@treeseed/sdk/reconcile';
import { compileDesiredResourceGraph, compileDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import type { CommandContext } from '../../../../types.js';
import { createMarketClientForInvocation } from '../../../content/market-utils.js';
import { capacityWorkdayAgentClassId } from './capacity-workday-agent-class.js';
import { treeDxRepositoryIdsFromReconcileResults } from './capacity-workday-treedx.js';

function treeDxRepositoryIdForProjectSlug(slug: string) {
	return `treeseed-${slug}`.toLowerCase().replace(/[^a-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'treeseed-project';
}

export type CapacityWorkdayAgentSpec = {
	id: string;
	slug: string;
	name: string;
	handler: string;
	projectAgentClassId: string;
	projectAgentClassSlug: string;
	contentPath: string;
	purpose: string;
	promptTask: string | null;
	outputContract: Record<string, unknown>;
	planningIntent: Record<string, unknown>;
	planningPriority: number | null;
	activityType: 'planning' | 'estimating' | 'reviewing' | 'reporting' | 'acting';
	activities: Record<string, Record<string, unknown>>;
};

export function objectArg(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function readCapacityWorkdayAgentSpecs(context: CommandContext, projectSlug: string): Promise<CapacityWorkdayAgentSpec[]> {
	const agentDir = projectSlug === 'market'
		? resolve(context.cwd, 'src/content/agents')
		: resolve(context.cwd, 'packages', projectSlug, 'docs/src/content/agents');
	const entries = await readdir(agentDir, { withFileTypes: true }).catch(() => []);
	const specs: CapacityWorkdayAgentSpec[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !/\.mdx?$/u.test(entry.name)) continue;
		const contentPath = resolve(agentDir, entry.name);
		const source = await readFile(contentPath, 'utf8').catch(() => '');
		const frontmatter = objectArg(parseFrontmatterDocument(source).frontmatter);
		if (frontmatter.enabled === false || frontmatter.runtimeStatus === 'dormant') continue;
		const activityProfiles = objectArg(frontmatter.activityProfiles);
		const identity = objectArg(frontmatter.identity);
		const activities = Object.fromEntries((['planning', 'reporting', 'reviewing', 'estimating', 'acting'] as const).flatMap((activityType) => {
			const profile = objectArg(activityProfiles[activityType]);
			const handler = profile.enabled === false ? null : optionalString(profile.handler);
			if (!handler) return [];
			const prompt = objectArg(profile.prompt);
			const workday = objectArg(profile.workday ?? profile.planningIntent);
			return [[activityType, {
				handler,
				purpose: optionalString(identity.purpose) ?? optionalString(frontmatter.description) ?? `Perform configured ${activityType} work.`,
				promptTask: optionalString(prompt.task),
				outputContract: objectArg(profile.outputs),
				planningIntent: workday,
				planningPriority: Number.isFinite(Number(workday.priority)) ? Number(workday.priority) : null,
			}]];
		}));
		const selectedActivity = (['planning', 'reporting', 'reviewing', 'estimating', 'acting'] as const)
			.map((activityType) => ({ activityType, profile: objectArg(activities[activityType]) }))
			.find(({ profile }) => optionalString(profile.handler));
		if (!selectedActivity) continue;
		const planning = selectedActivity.profile;
		const handler = optionalString(planning.handler);
		if (!handler) continue;
		const slug = optionalString(frontmatter.slug) ?? entry.name.replace(/\.mdx?$/u, '');
		specs.push({
			id: optionalString(frontmatter.id) ?? `agent:${slug}`,
			slug,
			name: optionalString(frontmatter.name) ?? optionalString(frontmatter.title) ?? slug,
			handler,
			projectAgentClassId: optionalString(frontmatter.projectAgentClassId) ?? optionalString(frontmatter.agentClassId) ?? optionalString(frontmatter.agentClass) ?? 'planning',
			projectAgentClassSlug: optionalString(frontmatter.projectAgentClassSlug) ?? optionalString(frontmatter.agentClassSlug) ?? optionalString(frontmatter.projectAgentClassId) ?? optionalString(frontmatter.agentClass) ?? 'planning',
			contentPath,
			purpose: optionalString(identity.purpose) ?? optionalString(frontmatter.description) ?? `Perform configured planning work as ${slug}.`,
			promptTask: optionalString(planning.promptTask),
			outputContract: objectArg(planning.outputContract),
			planningIntent: objectArg(planning.planningIntent),
			planningPriority: Number.isFinite(Number(planning.planningPriority)) ? Number(planning.planningPriority) : null,
			activityType: selectedActivity.activityType,
			activities,
		});
	}
	return specs.sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function ensureCapacityWorkdayAgentClasses(
	client: ReturnType<typeof createMarketClientForInvocation>['client'],
	context: CommandContext,
	projectId: string,
	projectSlug: string,
	existingClasses: Array<Record<string, unknown>>,
	operationKey: string,
) {
	const existingByKey = new Map(existingClasses.flatMap((agentClass) => [
		[String(agentClass.id ?? ''), agentClass] as const,
		[String(agentClass.slug ?? ''), agentClass] as const,
	]).filter(([key]) => key.length > 0));
	const created: Array<Record<string, unknown>> = [];
	const specs = await readCapacityWorkdayAgentSpecs(context, projectSlug);
	for (const classId of [...new Set(specs.map((spec) => spec.projectAgentClassId))]) {
		const classSpecs = specs.filter((spec) => spec.projectAgentClassId === classId);
		const first = classSpecs[0];
		if (!first) continue;
		const existing = existingByKey.get(classId) ?? existingByKey.get(first.projectAgentClassSlug);
		const body = {
			id: capacityWorkdayAgentClassId(projectId, classId),
			slug: first.projectAgentClassSlug,
			name: `${first.projectAgentClassSlug.replace(/[-_]+/gu, ' ')} agents`,
			status: 'active',
			allowedModes: ['planning', 'acting'],
			requiredCapabilities: ['repo_read', 'agent_mode_run'],
			handlerRefs: {
				agents: classSpecs.map((spec) => ({
					slug: spec.slug,
					activities: spec.activities,
				})),
			},
			metadata: {
				source: 'project_agent_content_sync',
				agentCount: classSpecs.length,
				agentSlugs: classSpecs.map((spec) => spec.slug),
				contentPaths: classSpecs.map((spec) => spec.contentPath.replace(`${context.cwd}/`, '')),
			},
		};
		const response = existing
			? await client.updateProjectAgentClass(projectId, String(existing.id ?? classId), body, `${operationKey}:${projectId}:${classId}:update`)
			: await client.createProjectAgentClass(projectId, body, `${operationKey}:${projectId}:${classId}:create`);
		if (response?.payload) {
			created.push(response.payload);
			existingByKey.set(classId, response.payload);
			existingByKey.set(first.projectAgentClassSlug, response.payload);
		}
	}
	return {
		agentClasses: [...new Map([...existingByKey.values()].map((agentClass) => [String(agentClass.id ?? agentClass.slug), agentClass])).values()],
		created,
		contentAgents: specs,
		contentAgentCount: specs.length,
	};
}

export async function ensureLocalTreeDxForCapacityWorkday(context: CommandContext, projectSlugs: string[]) {
	const target = { kind: 'persistent' as const, scope: 'local' as const };
	const desiredGraph = compileDesiredResourceGraph({
		tenantRoot: context.cwd,
		target,
		localContent: 'edit',
	});
	const unitIds = ['local-docker-compose:treedx', 'local-treedx:team-primary'];
	const selector: ReconcileSelector = {
		environment: 'local',
		unitId: unitIds,
	};
	const selected = new Set(unitIds);
	const units = compileDesiredUnitsFromGraph(desiredGraph, selector)
		.filter((unit) => selected.has(unit.unitId))
		.map((unit) => {
			if (unit.unitId !== 'local-treedx:team-primary') return unit;
			const projects = Array.isArray(unit.spec.projects)
				? unit.spec.projects.filter((project) => projectSlugs.includes(String((project as Record<string, unknown>).slug ?? '')))
				: [];
			return {
				...unit,
				spec: {
					...unit.spec,
					projects,
				},
			};
		});
	if (units.length !== unitIds.length) {
		throw new Error(`Local TreeDX readiness expected ${unitIds.length} units but resolved ${units.length}.`);
	}
	const result = await reconcileTarget({
		tenantRoot: context.cwd,
		target,
		env: context.env,
		units,
		selector,
		write: (line) => context.write(`[workday-run] ${line}`, 'stderr'),
	});
	const failed = result.results?.filter((entry) => entry.error || entry.verification?.verified === false) ?? [];
	if (failed.length > 0) {
		throw new Error(`Local TreeDX readiness failed for ${failed.map((entry) => entry.unit?.unitId ?? 'unknown').join(', ')}.`);
	}
	const repositoryIdsBySlug = treeDxRepositoryIdsFromReconcileResults(result.results);
	return {
		unitIds,
		projectSlugs,
		repositoryIdsBySlug,
		results: result.results?.map((entry) => ({
			unitId: entry.unit?.unitId ?? null,
			action: entry.action,
			verified: entry.verification?.verified ?? null,
			issues: entry.verification?.issues ?? [],
			error: entry.error ?? null,
		})) ?? [],
	};
}

