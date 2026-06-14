import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';
import { compileTreeseedDesiredResourceGraph, selectTreeseedDesiredResources } from '@treeseed/sdk/platform/desired-state';

type SavePlanRepo = {
	name: string;
	relativePath?: string;
	kind?: string;
	currentBranch?: string | null;
	targetBranch?: string;
	branchMode?: string;
	dirty?: boolean;
	currentVersion?: string | null;
	plannedVersion?: string | null;
	plannedTag?: string | null;
	plannedDependencySpec?: string | null;
	dependencies?: string[];
	commands?: string[];
	notes?: string[];
};

type SavePlanWave = {
	index: number;
	parallel: boolean;
	repos: string[];
	commands: Array<{
		repo: string;
		commands: string[];
	}>;
};

function formatRepoPlanSummary(repo: SavePlanRepo) {
	const branch = repo.currentBranch && repo.targetBranch && repo.currentBranch !== repo.targetBranch
		? `${repo.currentBranch} -> ${repo.targetBranch}`
		: repo.targetBranch ?? repo.currentBranch ?? 'unknown';
	const version = repo.plannedVersion
		? `, version ${repo.currentVersion ?? '?'} -> ${repo.plannedVersion}`
		: repo.currentVersion ? `, version ${repo.currentVersion}` : '';
	return `${repo.name} (${repo.kind ?? 'repo'}, ${repo.branchMode ?? 'unknown'}, ${repo.dirty ? 'dirty' : 'clean'}, branch ${branch}${version})`;
}

function formatSavePlanSections(repositoryPlan: {
	repos?: SavePlanRepo[];
	rootRepo?: SavePlanRepo;
	waves?: SavePlanWave[];
	plannedVersions?: Record<string, string>;
} | undefined) {
	if (!repositoryPlan) return [];
	const reposByName = new Map([
		...(repositoryPlan.repos ?? []),
		...(repositoryPlan.rootRepo ? [repositoryPlan.rootRepo] : []),
	].map((repo) => [repo.name, repo]));
	const sections = [];
	const repoLines = [
		...(repositoryPlan.repos ?? []).map((repo) => `- ${formatRepoPlanSummary(repo)}`),
		...(repositoryPlan.rootRepo ? [`- ${formatRepoPlanSummary(repositoryPlan.rootRepo)}`] : []),
	];
	if (repoLines.length > 0) {
		sections.push({ title: 'Repositories', lines: repoLines });
	}
	const versionEntries = Object.entries(repositoryPlan.plannedVersions ?? {});
	if (versionEntries.length > 0) {
		sections.push({
			title: 'Planned package versions',
			lines: versionEntries.map(([name, version]) => `- ${name}: ${version}`),
		});
	}
	const waveLines = [];
	for (const wave of repositoryPlan.waves ?? []) {
		waveLines.push(`Wave ${wave.index}${wave.parallel ? ' (parallel, concurrency 3)' : ''}: ${wave.repos.join(', ')}`);
		for (const entry of wave.commands) {
			const repo = reposByName.get(entry.repo);
			waveLines.push(`  ${entry.repo}${repo?.plannedDependencySpec ? ` -> ${repo.plannedDependencySpec}` : ''}`);
			entry.commands.forEach((command, index) => {
				waveLines.push(`    ${index + 1}. ${command}`);
			});
		}
	}
	if (waveLines.length > 0) {
		sections.push({ title: 'Execution order', lines: waveLines });
	}
	return sections;
}

function desiredResourceSections(input: {
	context: Parameters<TreeseedCommandHandler>[1];
	scope: string;
	applicationSelection?: { selected?: string[] };
	preview?: boolean;
	branch?: string;
	verifyDeployedResources?: boolean;
}) {
	const environment = input.scope === 'prod' ? 'prod' : input.scope === 'staging' ? 'staging' : 'local';
	const target = input.preview && input.branch
		? { kind: 'branch' as const, branchName: input.branch }
		: { kind: 'persistent' as const, scope: environment };
	const selectedApps = Array.isArray(input.applicationSelection?.selected)
		? input.applicationSelection.selected.filter((entry): entry is string => typeof entry === 'string')
		: [];
	const graph = compileTreeseedDesiredResourceGraph({ tenantRoot: input.context.cwd, target });
	const resourceKind = [
		...(input.preview ? ['branch-preview'] : []),
		...(input.verifyDeployedResources ? ['save-gate', 'release-gate'] : []),
		...(!input.preview && !input.verifyDeployedResources ? ['package-manifest', 'package-workflow', 'local-process'] : []),
	];
	const selected = selectTreeseedDesiredResources(graph, {
		environment,
		...(selectedApps.length > 0 ? { appId: selectedApps } : {}),
		...(resourceKind.length > 0 ? { resourceKind } : {}),
	});
	return [{
		title: 'Desired resources',
		lines: selected.resources.length > 0
			? selected.resources.map((resource) => `- ${resource.id} (${resource.kind}, ${resource.provider})`)
			: ['No desired resources selected.'],
	}];
}

export const handleSave: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const progressWrite = context.outputFormat === 'json'
			? ((output: string) => context.write(output, 'stderr'))
			: context.write;
		const result = await createWorkflowSdk(context, {
			write: progressWrite,
		}).save({
			message: invocation.positionals.join(' ').trim(),
			hotfix: invocation.args.hotfix === true,
			preview: invocation.args.preview === true,
			lane: typeof invocation.args.lane === 'string' ? invocation.args.lane as 'fast' | 'promotion' : undefined,
			ciMode: typeof invocation.args.ciMode === 'string' ? invocation.args.ciMode as 'auto' | 'hosted' | 'off' : undefined,
			verifyMode: typeof invocation.args.verifyMode === 'string' ? invocation.args.verifyMode as 'fast' | 'local' | 'hosted' | 'both' | 'skip' : undefined,
			releaseCandidate: typeof invocation.args.releaseCandidate === 'string' ? invocation.args.releaseCandidate as 'hybrid' | 'strict' | 'skip' : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branch: string;
			scope: string;
			hotfix: boolean;
			message: string;
			resumed?: boolean;
			resumedRunId?: string | null;
			autoResumeCandidate?: { runId?: string | null } | null;
			commitSha?: string | null;
			commitCreated?: boolean;
			noChanges?: boolean;
			repos?: Array<{
				name: string;
				commitSha?: string | null;
				committed?: boolean;
				pushed?: boolean;
				skippedReason?: string | null;
			}>;
			rootRepo?: {
				committed?: boolean;
				pushed?: boolean;
			};
			repositoryPlan?: {
				repos?: SavePlanRepo[];
				rootRepo?: SavePlanRepo;
				waves?: SavePlanWave[];
				plannedVersions?: Record<string, string>;
			};
			plannedSteps?: Array<{ id?: string; description?: string }>;
			previewAction?: { status: string };
			lane?: string;
			ciMode?: string;
			verifyMode?: string;
			releaseCandidateMode?: string;
			workflowGates?: Array<{ status?: string; conclusion?: string | null }>;
			applicationSelection?: { selected?: string[]; skipped?: Array<{ appId?: string; reason?: string }> };
			worktreeMode?: string;
			worktreePath?: string | null;
		};
		const commitSha = typeof payload.commitSha === 'string' && payload.commitSha.length > 0
			? payload.commitSha.slice(0, 12)
			: 'not applicable';
		const savedRepos = (payload.repos ?? [])
			.filter((repo) => repo.committed || repo.pushed)
			.map((repo) => `${repo.name}@${String(repo.commitSha ?? '').slice(0, 12)}`)
			.join(', ');
		const plannedRepos = result.executionMode === 'plan'
			? (payload.repositoryPlan?.repos ?? payload.repos ?? []).map((repo) => repo.name).join(', ')
			: '';
		const desiredSections = desiredResourceSections({
			context,
			scope: payload.scope,
			applicationSelection: payload.applicationSelection,
			preview: payload.previewAction?.status === 'planned' || payload.previewAction?.status === 'created' || payload.previewAction?.status === 'refreshed',
			branch: payload.branch,
			verifyDeployedResources: payload.verifyMode === 'hosted' || payload.verifyMode === 'both',
		});
		return guidedResult({
			command: invocation.commandName || 'save',
			summary: result.executionMode === 'plan'
				? 'Treeseed save plan ready.'
				: payload.noChanges ? 'Treeseed save found no new changes and confirmed branch sync.' : 'Treeseed save completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Branch', value: payload.branch },
				{ label: 'Environment scope', value: payload.scope },
				{ label: 'Hotfix', value: payload.hotfix ? 'yes' : 'no' },
				{
					label: result.executionMode === 'plan' ? 'Interrupted save' : 'Resumed run',
					value: result.executionMode === 'plan'
						? payload.autoResumeCandidate?.runId ? `will resume ${payload.autoResumeCandidate.runId}` : 'none'
						: payload.resumedRunId ?? 'none',
				},
				{ label: 'Commit', value: commitSha },
				{ label: 'Commit created', value: payload.commitCreated ? 'yes' : 'no' },
				{
					label: result.executionMode === 'plan' ? 'Workspace repos planned' : 'Workspace repos',
					value: result.executionMode === 'plan'
						? (plannedRepos || 'not applicable')
						: savedRepos || ((payload.repos ?? []).length > 0 ? 'none saved' : 'not applicable'),
				},
				{ label: 'Market pushed', value: payload.rootRepo?.pushed ? 'yes' : 'no' },
				{ label: 'Preview action', value: payload.previewAction?.status ?? 'skipped' },
				{ label: 'Lane', value: payload.lane ?? 'fast' },
				{ label: 'CI mode', value: payload.ciMode ?? 'auto' },
				{ label: 'Release candidate', value: payload.releaseCandidateMode ?? 'n/a' },
				{ label: 'Selected apps', value: payload.applicationSelection?.selected?.join(', ') || 'all' },
				{ label: 'Workflow gates', value: String(payload.workflowGates?.length ?? 0) },
				{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
			],
			sections: result.executionMode === 'plan' ? [
				...desiredSections,
				...(payload.plannedSteps?.length
					? [{ title: 'Dependency mode transitions', lines: payload.plannedSteps
						.filter((step) => /workspace-(?:link|unlink)/u.test(String(step.id ?? '')))
						.map((step) => `- ${step.description ?? step.id}`) }]
					: []),
				...formatSavePlanSections(payload.repositoryPlan),
			] : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: {
				...result,
				desiredResourceSections: desiredSections,
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
