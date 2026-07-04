import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, hostingGraphSections, renderWorkflowNextSteps, resolveWorkflowHostingGraph, workflowErrorResult } from './workflow.js';

export const handleStage: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).stage({
			message: invocation.positionals.join(' ').trim(),
			verifyMode: typeof invocation.args.verify === 'string' ? invocation.args.verify as 'action' | 'local' | 'none' : undefined,
			ciMode: typeof invocation.args.ciMode === 'string' ? invocation.args.ciMode as 'hosted' | 'off' : undefined,
			cleanupMode: typeof invocation.args.cleanup === 'string' ? invocation.args.cleanup as 'success' | 'manual' : undefined,
			updateFrom: typeof invocation.args.updateFrom === 'string' ? invocation.args.updateFrom : undefined,
			releaseCandidate: typeof invocation.args.releaseCandidate === 'string' ? invocation.args.releaseCandidate as 'hybrid' | 'strict' | 'skip' : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			skipCleanup: invocation.args.skipCleanup === true,
			sceneArtifacts: invocation.args.noSceneVideo === true ? 'screenshots' : typeof invocation.args.sceneArtifacts === 'string' ? invocation.args.sceneArtifacts as 'full' | 'screenshots' : undefined,
			plan: invocation.args.plan === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace' | 'reconcile-release-gates';
			branchName?: string;
			mergeTarget?: string;
			mergeStrategy?: string;
			verifyMode?: string;
			cleanupMode?: string;
			autoSaved?: boolean;
			repos?: Array<{ merged: boolean; deletedLocal: boolean; deletedRemote: boolean; skippedReason: string | null }>;
			rootRepo?: { deletedLocal: boolean; deletedRemote: boolean; tagName: string | null };
			stagingWait?: { status: string };
			hostedCi?: { status?: string };
			releaseCandidateMode?: string;
			previewCleanup?: { performed: boolean };
			finalBranch?: string;
			ciMode?: string;
			workflowGates?: Array<Record<string, unknown>>;
			applicationSelection?: { selected?: string[]; skipped?: Array<{ appId?: string; reason?: string }> };
			worktreeCleanup?: { removed?: boolean };
			worktreePath?: string | null;
			blockers?: string[];
			units?: Array<{
				unitId?: string;
				unitType?: string;
				provider?: string;
				logicalName?: string;
				dependencies?: string[];
			}>;
			plannedSteps?: Array<{
				unitId?: string;
				action?: string;
				status?: string;
				summary?: string;
			}>;
			reconcile?: unknown;
		};
		if (payload.mode === 'reconcile-release-gates') {
			const hostingGraph = resolveWorkflowHostingGraph(context, 'staging', payload.applicationSelection);
			const report = {
				schemaVersion: result.schemaVersion,
				kind: result.kind,
				command: result.command,
				executionMode: result.executionMode,
				runId: result.runId,
				ok: result.ok,
				operation: result.operation,
				payload: {
					mode: payload.mode,
					branchName: payload.branchName,
					mergeTarget: payload.mergeTarget ?? 'staging',
					mergeStrategy: payload.mergeStrategy ?? 'squash',
					applicationSelection: payload.applicationSelection,
					units: payload.units?.map((unit) => ({
						unitId: unit.unitId,
						unitType: unit.unitType,
						provider: unit.provider,
						logicalName: unit.logicalName,
						dependencies: unit.dependencies,
					})),
					plannedSteps: payload.plannedSteps?.map((step) => ({
						unitId: step.unitId,
						action: step.action,
						status: step.status,
						summary: step.summary,
					})),
					worktreePath: payload.worktreePath ?? null,
				},
				errors: result.errors ?? [],
			};
			return guidedResult({
				command: invocation.commandName || 'stage',
				summary: result.executionMode === 'plan' ? 'Treeseed stage promotion plan ready.' : 'Treeseed stage promotion completed.',
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
				report,
			});
		}
		const mergedPackages = (payload.repos ?? []).filter((repo) => repo.merged).length;
		const blocked = (payload.blockers?.length ?? 0) > 0;
		const hostingGraph = blocked || payload.mode === 'stage-promotion' ? null : resolveWorkflowHostingGraph(context, 'staging', payload.applicationSelection);
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
				...(hostingGraph ? { hostingGraph } : {}),
			};
		return guidedResult({
			command: invocation.commandName || 'stage',
			summary: blocked
				? 'Treeseed stage plan blocked.'
				: result.executionMode === 'plan' && payload.mode === 'stage-promotion'
					? 'Treeseed stage promotion plan ready.'
					: result.executionMode === 'plan' ? 'Treeseed stage plan ready.' : 'Treeseed stage completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Merged branch', value: payload.branchName },
				{ label: 'Merge target', value: payload.mergeTarget },
				{ label: 'Merge strategy', value: payload.mergeStrategy },
				{ label: 'Verify mode', value: payload.verifyMode ?? 'action' },
				{ label: 'CI mode', value: payload.ciMode ?? 'off' },
				{ label: 'Cleanup mode', value: payload.cleanupMode ?? 'manual' },
				{ label: 'Auto-saved', value: payload.autoSaved ? 'yes' : 'no' },
				{ label: 'Package merges', value: String(mergedPackages) },
				...(payload.blockers?.length
					? [{ label: 'Blockers', value: payload.blockers.join('; ') }]
					: []),
				{ label: 'Staging wait', value: payload.hostedCi?.status ?? payload.stagingWait?.status ?? (payload.ciMode === 'off' ? 'skipped' : result.executionMode === 'plan' ? 'planned' : 'unknown') },
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
