import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary, run, workspaceRoot } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, hostingGraphSections, renderWorkflowNextSteps, resolveWorkflowHostingGraph, workflowErrorResult } from './workflow.js';

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

function dispatchProductionRelease(context: Parameters<TreeseedCommandHandler>[1], bump: 'major' | 'minor' | 'patch') {
	const root = workspaceRoot(context.cwd);
	const attestationPath = resolve(root, '.treeseed', 'workflow', 'stage-candidates', 'latest.attestation.json');
	if (!existsSync(attestationPath)) throw new Error('No staging candidate attestation is available. Complete `trsd stage` before release.');
	const attestation = JSON.parse(readFileSync(attestationPath, 'utf8')) as {
		candidateId?: string;
		rootSha?: string;
		status?: string;
		counts?: { failed?: number; blocked?: number; skipped?: number; releaseBlockingFailures?: number };
	};
	if (!attestation.candidateId || !attestation.rootSha || attestation.status !== 'passed') {
		throw new Error('The latest staging candidate attestation is incomplete or unsuccessful.');
	}
	if (attestation.counts?.failed || attestation.counts?.blocked || attestation.counts?.skipped || attestation.counts?.releaseBlockingFailures) {
		throw new Error(`Staging candidate ${attestation.candidateId} is not a complete passing guarantee run.`);
	}
	const gh = resolveTreeseedToolBinary('gh', { env: context.env });
	if (!gh) throw new Error('GitHub CLI is unavailable. Run `trsd install --json` and retry.');
	const env = createTreeseedManagedToolEnv(context.env);
	run(gh, [
		'workflow', 'run', 'production-release.yml', '--ref', 'staging',
		'-f', `candidate_id=${attestation.candidateId}`,
		'-f', `bump=${bump}`,
	], { cwd: root, env });
	let runId: number | null = null;
	for (let attempt = 0; attempt < 120 && runId == null; attempt += 1) {
		const output = run(gh, [
			'run', 'list', '--workflow', 'production-release.yml', '--branch', 'staging',
			'--commit', attestation.rootSha, '--event', 'workflow_dispatch', '--limit', '1', '--json', 'databaseId',
		], { cwd: root, env, capture: true });
		const rows = JSON.parse(output || '[]') as Array<{ databaseId?: number }>;
		runId = typeof rows[0]?.databaseId === 'number' ? rows[0].databaseId : null;
		if (runId == null) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
	}
	if (runId == null) throw new Error(`Production release workflow did not start for candidate ${attestation.candidateId}.`);
	run(gh, ['run', 'watch', String(runId), '--exit-status'], { cwd: root, env });
	return { attestation, runId };
}

export const handleRelease: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const traceRelease = (phase: string) => {
			console.error(`[release][cli] ${phase}`);
		};
		const releasePlanOnly = invocation.args.plan === true;
		const repairVersionLine = invocation.args.repairVersionLine === true;
		const bump = (['major', 'minor', 'patch'] as const).find((candidate) => invocation.args[candidate] === true) ?? 'patch';
		if (!releasePlanOnly && context.env.TREESEED_RELEASE_EXECUTION !== 'hosted') {
			traceRelease('dispatch production release');
			const dispatched = dispatchProductionRelease(context, bump);
			return guidedResult({
				command: invocation.commandName || 'release',
				summary: 'Treeseed production release completed in GitHub Actions.',
				facts: [
					{ label: 'Candidate', value: dispatched.attestation.candidateId ?? '(unknown)' },
					{ label: 'Release level', value: bump },
					{ label: 'Workflow run', value: String(dispatched.runId) },
				],
				nextSteps: [],
				report: { schemaVersion: 1, kind: 'treeseed.production-release-dispatch', ...dispatched, bump },
			});
		}
		traceRelease('start workflow release');
		const result = await createWorkflowSdk(context).release({
			bump,
			repairVersionLine,
			targetVersionLine: typeof invocation.args.targetVersionLine === 'string' ? invocation.args.targetVersionLine : undefined,
			ciMode: typeof invocation.args.ciMode === 'string' ? invocation.args.ciMode as 'auto' | 'hosted' | 'off' : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			verifyDeployedResources: invocation.args.verifyDeployedResources === true,
			fresh: invocation.args.fresh === true,
			skipCleanup: invocation.args.skipCleanup === true,
			sceneArtifacts: invocation.args.noSceneVideo === true ? 'screenshots' : typeof invocation.args.sceneArtifacts === 'string' ? invocation.args.sceneArtifacts as 'full' | 'screenshots' : undefined,
			plan: releasePlanOnly,
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
				{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
				{ label: 'Final branch', value: payload.finalBranch ?? (result.executionMode === 'plan' ? payload.stagingBranch : '(unknown)') },
			],
			sections: result.executionMode === 'plan' ? [
				...hostingGraphSections(hostingGraph),
				...formatReleasePlanSections(payload),
			] : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: {
				...result,
				hostingGraph,
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
