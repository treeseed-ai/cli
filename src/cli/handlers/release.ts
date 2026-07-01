import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, hostingGraphSections, renderWorkflowNextSteps, resolveWorkflowHostingGraph, workflowErrorResult } from './workflow.js';
import { discoverTreeseedGuarantees, planTreeseedGuarantees, runTreeseedGuarantees } from '@treeseed/sdk/guarantees';

function formatReleasePlanSections(payload: {
	packageSelection?: { changed?: string[]; dependents?: string[]; selected?: string[] };
	plannedVersions?: Record<string, string>;
	plannedDevReferenceRewrites?: Array<{ repoName?: string; dependencyName?: string; field?: string; spec?: string; reason?: string; filePath?: string }>;
	plannedPublishWaits?: Array<{ name?: string; workflow?: string; branch?: string; status?: string }>;
	plannedSteps?: Array<{ id?: string; description?: string }>;
	blockers?: string[];
	releaseLine?: { targetLine?: unknown; highestCurrentLine?: unknown; repair?: unknown; alignedBefore?: unknown };
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
	if (payload.releaseLine) {
		sections.push({
			title: 'Release line',
			lines: [
				`Target: ${String(payload.releaseLine.targetLine ?? 'unknown')}`,
				`Highest current: ${String(payload.releaseLine.highestCurrentLine ?? 'unknown')}`,
				`Repair: ${payload.releaseLine.repair === true ? 'yes' : 'no'}`,
				`Aligned before: ${payload.releaseLine.alignedBefore === true ? 'yes' : 'no'}`,
			],
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
		const guaranteeRegistry = discoverTreeseedGuarantees({ workspaceRoot: context.cwd });
		if (!guaranteeRegistry.ok) {
			return {
				exitCode: 1,
				stdout: [
					'Treeseed release blocked by invalid guarantee registry.',
					...guaranteeRegistry.diagnostics
						.filter((entry) => entry.severity === 'error')
						.map((entry) => `${entry.code}: ${entry.message}${entry.sourcePath ? ` (${entry.sourcePath})` : ''}`),
				],
				stderr: [],
				report: {
					command: invocation.commandName || 'release',
					ok: false,
					error: 'guarantee_registry_invalid',
					guarantees: guaranteeRegistry,
				},
			};
		}
		const guaranteeEnvironment = 'staging';
		const guaranteeReleasePlan = planTreeseedGuarantees({ workspaceRoot: context.cwd, filter: { gate: 'release' }, environment: guaranteeEnvironment });
		const releasePlanOnly = invocation.args.plan === true || invocation.args.dryRun === true;
		const guaranteeReleaseRun = releasePlanOnly ? null : await runTreeseedGuarantees({
			workspaceRoot: context.cwd,
			filter: { gate: 'release', status: 'active' },
			environment: guaranteeEnvironment,
			evidenceTarget: 'release',
			record: true,
			failOnSkippedReleaseGuarantees: true,
		});
		if (guaranteeReleaseRun && !guaranteeReleaseRun.ok) {
			return {
				exitCode: 1,
				stdout: [
					'Treeseed release blocked by failing product guarantees.',
					`Run: ${guaranteeReleaseRun.runId}`,
					`Failed: ${guaranteeReleaseRun.counts.failed}`,
					`Blocked: ${guaranteeReleaseRun.counts.blocked}`,
					`Skipped: ${guaranteeReleaseRun.counts.skipped}`,
					`Release blocking failures: ${guaranteeReleaseRun.counts.releaseBlockingFailures}`,
					`Evidence: ${guaranteeReleaseRun.outputRoot}`,
				],
				stderr: [],
				report: {
					command: invocation.commandName || 'release',
					ok: false,
					error: 'guarantee_release_run_failed',
					guarantees: {
						validation: guaranteeRegistry,
						releasePlan: guaranteeReleasePlan,
						releaseRun: guaranteeReleaseRun,
					},
				},
			};
		}
		const repairVersionLine = invocation.args.repairVersionLine === true;
		const bump = (['major', 'minor', 'patch'] as const).find((candidate) => invocation.args[candidate] === true) ?? 'patch';
		const result = await createWorkflowSdk(context).release({
			bump,
			repairVersionLine,
			targetVersionLine: typeof invocation.args.targetVersionLine === 'string' ? invocation.args.targetVersionLine : undefined,
			ciMode: typeof invocation.args.ciMode === 'string' ? invocation.args.ciMode as 'auto' | 'hosted' | 'off' : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			verifyDeployedResources: invocation.args.verifyDeployedResources === true,
			fresh: invocation.args.fresh === true,
			plan: releasePlanOnly,
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
			releaseLine?: Record<string, unknown>;
			plannedDevReferenceRewrites?: Array<{ repoName?: string; dependencyName?: string; field?: string; spec?: string; reason?: string; filePath?: string }>;
			plannedSteps?: Array<{ id?: string; description?: string }>;
			blockers?: string[];
			finalBranch?: string;
			ciMode?: string;
			fresh?: boolean;
			workflowGates?: Array<Record<string, unknown>>;
			applicationSelection?: { selected?: string[]; skipped?: Array<{ appId?: string; reason?: string }> };
			worktreePath?: string | null;
		};
		const publishWait = payload.publishWait ?? [];
		const completedPublishes = publishWait.filter((entry) => entry.status === 'completed').length;
		const plannedPublishes = payload.plannedPublishWaits?.length ?? 0;
		const releasedCommit = typeof payload.releasedCommit === 'string' && payload.releasedCommit.length > 0
			? payload.releasedCommit.slice(0, 12)
			: result.executionMode === 'plan' ? 'planned' : 'not available';
		const hostingGraph = resolveWorkflowHostingGraph(context, 'prod', payload.applicationSelection);
		return guidedResult({
			command: invocation.commandName || 'release',
			summary: result.executionMode === 'plan' ? 'Treeseed release plan ready.' : 'Treeseed release completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Staging branch', value: payload.stagingBranch },
				{ label: 'Production branch', value: payload.productionBranch },
				{ label: 'Merge strategy', value: payload.mergeStrategy },
				{ label: 'Release level', value: payload.level },
				{ label: 'Release line', value: String(payload.releaseLine?.targetLine ?? '(none)') },
				{ label: 'Root version', value: payload.rootVersion ?? payload.plannedVersions?.['@treeseed/market'] ?? '(planned)' },
				{ label: 'Release tag', value: payload.releaseTag ?? payload.rootVersion ?? payload.plannedVersions?.['@treeseed/market'] ?? '(planned)' },
				{ label: 'Released commit', value: releasedCommit },
				{ label: 'Changed packages', value: String(payload.packageSelection.changed.length) },
				{ label: 'Dependent packages', value: String(payload.packageSelection.dependents.length) },
				{ label: result.executionMode === 'plan' ? 'Packages planned' : 'Released packages', value: String((payload.touchedPackages ?? payload.packageSelection.selected).length) },
				{ label: 'Publish waits', value: result.executionMode === 'plan' ? String(plannedPublishes) : String(completedPublishes) },
				{ label: 'CI mode', value: payload.ciMode ?? 'auto' },
				{ label: 'Selected apps', value: payload.applicationSelection?.selected?.join(', ') || 'all' },
				{ label: 'Fresh release', value: payload.fresh === true ? 'yes' : 'no' },
				{ label: 'Workflow gates', value: String(payload.workflowGates?.length ?? 0) },
				{ label: 'Release guarantees', value: String(guaranteeReleasePlan.counts.withDependencies) },
				{ label: 'Guarantee environment', value: guaranteeEnvironment },
				{ label: 'Guarantee evidence', value: guaranteeReleaseRun?.outputRoot ?? (result.executionMode === 'plan' ? '(planned)' : '(none)') },
				{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
				{ label: 'Final branch', value: payload.finalBranch ?? (result.executionMode === 'plan' ? payload.stagingBranch : '(unknown)') },
			],
			sections: result.executionMode === 'plan' ? [
				...hostingGraphSections(hostingGraph),
				{
					title: 'Product guarantees',
					lines: [
						`Selected release guarantees: ${guaranteeReleasePlan.counts.selected}`,
						`With dependencies: ${guaranteeReleasePlan.counts.withDependencies}`,
						`Execution environment: ${guaranteeEnvironment}`,
						'Guarantee execution is enforced by the TreeSeed guarantee runner before production promotion when release execution is enabled.',
					],
				},
				...formatReleasePlanSections(payload),
			] : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: {
				...result,
				hostingGraph,
				guarantees: {
					validation: guaranteeRegistry,
					releasePlan: guaranteeReleasePlan,
					...(guaranteeReleaseRun ? { releaseRun: guaranteeReleaseRun } : {}),
				},
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
