import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

function formatReleasePlanSections(payload: {
	packageSelection?: { changed?: string[]; dependents?: string[]; selected?: string[] };
	plannedVersions?: Record<string, string>;
	plannedDevReferenceRewrites?: Array<{ repoName?: string; dependencyName?: string; field?: string; spec?: string; reason?: string; filePath?: string }>;
	plannedPublishWaits?: Array<{ name?: string; workflow?: string; branch?: string; status?: string }>;
	plannedSteps?: Array<{ id?: string; description?: string }>;
	blockers?: string[];
}) {
	const sections = [];
	const selection = payload.packageSelection ?? {};
	const selected = selection.selected ?? [];
	if (selected.length > 0 || (selection.changed ?? []).length > 0 || (selection.dependents ?? []).length > 0) {
		sections.push({
			title: 'Package selection',
			lines: [
				`Changed: ${(selection.changed ?? []).join(', ') || 'none'}`,
				`Dependents: ${(selection.dependents ?? []).join(', ') || 'none'}`,
				`Selected: ${selected.join(', ') || 'none'}`,
			],
		});
	}
	const versions = Object.entries(payload.plannedVersions ?? {});
	if (versions.length > 0) {
		sections.push({
			title: 'Planned versions',
			lines: versions.map(([name, version]) => `- ${name}: ${version}`),
		});
	}
	const rewrites = payload.plannedDevReferenceRewrites ?? [];
	if (rewrites.length > 0) {
		sections.push({
			title: 'Dependency rewrites',
			lines: rewrites.map((rewrite) => {
				const target = rewrite.dependencyName ? `${rewrite.field ?? 'dependencies'}.${rewrite.dependencyName}` : rewrite.filePath ?? 'lockfile';
				return `- ${rewrite.repoName ?? 'repo'} ${target}: ${rewrite.reason ?? 'dev-ref'} ${rewrite.spec ?? ''}`.trim();
			}),
		});
	}
	const waits = payload.plannedPublishWaits ?? [];
	if (waits.length > 0) {
		sections.push({
			title: 'Publish waits',
			lines: waits.map((wait) => `- ${wait.name ?? 'package'}: ${wait.workflow ?? 'publish.yml'} on ${wait.branch ?? 'main'} (${wait.status ?? 'planned'})`),
		});
	}
	const steps = payload.plannedSteps ?? [];
	if (steps.length > 0) {
		sections.push({
			title: 'Execution order',
			lines: steps.map((step, index) => `${index + 1}. ${step.description ?? step.id ?? 'step'}`),
		});
	}
	if ((payload.blockers ?? []).length > 0) {
		sections.push({
			title: 'Blockers',
			lines: (payload.blockers ?? []).map((blocker) => `- ${blocker}`),
		});
	}
	return sections;
}

export const handleRelease: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const bump = (['major', 'minor', 'patch'] as const).find((candidate) => invocation.args[candidate] === true) ?? 'patch';
		const result = await createWorkflowSdk(context).release({
			bump,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			mergeStrategy: string;
			level: string;
			rootVersion?: string;
			releaseTag?: string;
			releasedCommit?: string;
			stagingBranch: string;
			productionBranch: string;
			touchedPackages?: string[];
			packageSelection: { changed: string[]; dependents: string[]; selected: string[] };
			publishWait?: Array<{ name: string; status: string; conclusion?: string | null }>;
			plannedPublishWaits?: Array<{ name?: string; workflow?: string; branch?: string; status?: string }>;
			plannedVersions?: Record<string, string>;
			plannedDevReferenceRewrites?: Array<{ repoName?: string; dependencyName?: string; field?: string; spec?: string; reason?: string; filePath?: string }>;
			plannedSteps?: Array<{ id?: string; description?: string }>;
			blockers?: string[];
			finalBranch?: string;
		};
		const publishWait = payload.publishWait ?? [];
		const completedPublishes = publishWait.filter((entry) => entry.status === 'completed').length;
		const plannedPublishes = payload.plannedPublishWaits?.length ?? 0;
		const releasedCommit = typeof payload.releasedCommit === 'string' && payload.releasedCommit.length > 0
			? payload.releasedCommit.slice(0, 12)
			: result.executionMode === 'plan' ? 'planned' : 'not available';
		return guidedResult({
			command: invocation.commandName || 'release',
			summary: result.executionMode === 'plan' ? 'Treeseed release plan ready.' : 'Treeseed release completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Staging branch', value: payload.stagingBranch },
				{ label: 'Production branch', value: payload.productionBranch },
				{ label: 'Merge strategy', value: payload.mergeStrategy },
				{ label: 'Release level', value: payload.level },
				{ label: 'Root version', value: payload.rootVersion ?? payload.plannedVersions?.['@treeseed/market'] ?? '(planned)' },
				{ label: 'Release tag', value: payload.releaseTag ?? payload.rootVersion ?? payload.plannedVersions?.['@treeseed/market'] ?? '(planned)' },
				{ label: 'Released commit', value: releasedCommit },
				{ label: 'Changed packages', value: String(payload.packageSelection.changed.length) },
				{ label: 'Dependent packages', value: String(payload.packageSelection.dependents.length) },
				{ label: result.executionMode === 'plan' ? 'Packages planned' : 'Released packages', value: String((payload.touchedPackages ?? payload.packageSelection.selected).length) },
				{ label: 'Publish waits', value: result.executionMode === 'plan' ? String(plannedPublishes) : String(completedPublishes) },
				{ label: 'Final branch', value: payload.finalBranch ?? (result.executionMode === 'plan' ? payload.stagingBranch : '(unknown)') },
			],
			sections: result.executionMode === 'plan' ? formatReleasePlanSections(payload) : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
