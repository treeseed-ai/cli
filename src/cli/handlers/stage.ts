import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, hostingGraphSections, renderWorkflowNextSteps, resolveWorkflowHostingGraph, workflowErrorResult } from './workflow.js';

export const handleStage: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).stage({
			message: invocation.positionals.join(' ').trim(),
			ciMode: typeof invocation.args.ciMode === 'string' ? invocation.args.ciMode as 'auto' | 'hosted' | 'off' : undefined,
			releaseCandidate: typeof invocation.args.releaseCandidate === 'string' ? invocation.args.releaseCandidate as 'hybrid' | 'strict' | 'skip' : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace' | 'reconcile-release-gates';
			branchName?: string;
			mergeTarget?: string;
			mergeStrategy?: string;
			autoSaved?: boolean;
			repos?: Array<{ merged: boolean; deletedLocal: boolean; deletedRemote: boolean; skippedReason: string | null }>;
			rootRepo?: { deletedLocal: boolean; deletedRemote: boolean; tagName: string | null };
			stagingWait?: { status: string };
			releaseCandidateMode?: string;
			previewCleanup?: { performed: boolean };
			finalBranch?: string;
			ciMode?: string;
			workflowGates?: Array<Record<string, unknown>>;
			applicationSelection?: { selected?: string[]; skipped?: Array<{ appId?: string; reason?: string }> };
			worktreeCleanup?: { removed?: boolean };
			worktreePath?: string | null;
			blockers?: string[];
			units?: Array<Record<string, unknown>>;
			plannedSteps?: Array<Record<string, unknown>>;
			reconcile?: unknown;
		};
		if (payload.mode === 'reconcile-release-gates') {
			const hostingGraph = resolveWorkflowHostingGraph(context, 'staging', payload.applicationSelection);
			return guidedResult({
				command: invocation.commandName || 'stage',
				summary: result.executionMode === 'plan' ? 'Treeseed stage release-gate plan ready.' : 'Treeseed stage release gates reconciled.',
				facts: [
					{ label: 'Mode', value: payload.mode },
					{ label: 'Merge target', value: payload.mergeTarget ?? 'staging' },
					{ label: 'Merge strategy', value: payload.mergeStrategy ?? 'squash' },
					{ label: 'Selected apps', value: payload.applicationSelection?.selected?.join(', ') || 'all' },
					{ label: 'Units', value: String(payload.units?.length ?? 0) },
					{ label: 'Planned steps', value: String(payload.plannedSteps?.length ?? 0) },
					{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
				],
				sections: result.executionMode === 'plan' ? hostingGraphSections(hostingGraph) : [],
				nextSteps: renderWorkflowNextSteps(result),
				report: {
					...result,
					hostingGraph,
				},
			});
		}
		const mergedPackages = (payload.repos ?? []).filter((repo) => repo.merged).length;
		const blocked = (payload.blockers?.length ?? 0) > 0;
		const hostingGraph = blocked ? null : resolveWorkflowHostingGraph(context, 'staging', payload.applicationSelection);
		const report = blocked
			? {
				schemaVersion: result.schemaVersion,
				kind: result.kind,
				command: result.command,
				executionMode: result.executionMode,
				runId: result.runId,
				ok: false,
				operation: result.operation,
				payload: {
					mode: payload.mode,
					branchName: payload.branchName,
					mergeTarget: payload.mergeTarget,
					mergeStrategy: payload.mergeStrategy,
					autoSaved: payload.autoSaved ?? false,
					blockers: payload.blockers ?? [],
					worktreePath: payload.worktreePath ?? null,
				},
				errors: result.errors ?? [],
			}
			: {
				...result,
				hostingGraph,
			};
		return guidedResult({
			command: invocation.commandName || 'stage',
			summary: blocked
				? 'Treeseed stage plan blocked.'
				: result.executionMode === 'plan' ? 'Treeseed stage plan ready.' : 'Treeseed stage completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Merged branch', value: payload.branchName },
				{ label: 'Merge target', value: payload.mergeTarget },
				{ label: 'Merge strategy', value: payload.mergeStrategy },
				{ label: 'Auto-saved', value: payload.autoSaved ? 'yes' : 'no' },
				{ label: 'Package merges', value: String(mergedPackages) },
				...(payload.blockers?.length
					? [{ label: 'Blockers', value: payload.blockers.join('; ') }]
					: []),
				{ label: 'Staging wait', value: payload.stagingWait?.status ?? (result.executionMode === 'plan' ? 'planned' : 'unknown') },
				{ label: 'Release candidate', value: payload.releaseCandidateMode ?? 'skip' },
				{ label: 'Selected apps', value: payload.applicationSelection?.selected?.join(', ') || 'all' },
				{ label: 'Workflow gates', value: String(payload.workflowGates?.length ?? 0) },
				{ label: 'Preview cleanup', value: payload.previewCleanup?.performed ? 'performed' : result.executionMode === 'plan' ? 'planned' : 'not needed' },
				{ label: 'Worktree cleanup', value: payload.worktreeCleanup?.removed ? 'removed' : 'not needed' },
				{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
				{ label: 'Final branch', value: payload.finalBranch ?? payload.mergeTarget },
			],
			sections: !blocked && result.executionMode === 'plan' && hostingGraph ? hostingGraphSections(hostingGraph) : [],
			nextSteps: blocked
				? ['treeseed status --json  # Inspect current branch and workflow state before staging.']
				: renderWorkflowNextSteps(result),
			exitCode: blocked ? 1 : 0,
			report,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
