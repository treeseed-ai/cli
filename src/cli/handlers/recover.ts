import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleRecover: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).recover({
			pruneStale: invocation.args.pruneStale === true,
			obsoleteRunId: typeof invocation.args.obsolete === 'string' ? invocation.args.obsolete : undefined,
			obsoleteReason: typeof invocation.args.reason === 'string' ? invocation.args.reason : undefined,
		});
		const payload = result.payload as {
			lock: {
				active: boolean;
				stale: boolean;
				lock: {
					runId?: string | null;
					command?: string | null;
					updatedAt?: string | null;
				} | null;
			};
			interruptedRuns: Array<{
				runId: string;
				command: string;
			}>;
			staleRuns?: Array<{ runId: string; command: string }>;
			obsoleteRuns?: Array<{ runId: string; command: string }>;
			prunedRuns?: Array<{ runId: string; command: string }>;
			markedObsoleteRun?: { runId: string; command: string; reason: string } | null;
			runCount: number;
		};
		const markedObsolete = payload.markedObsoleteRun;
		return guidedResult({
			command: 'recover',
			summary: markedObsolete
				? `Treeseed recover marked ${markedObsolete.runId} obsolete.`
				: payload.interruptedRuns.length > 0 || payload.lock.active
				? 'Treeseed recover found workflow state that may need attention.'
				: 'Treeseed recover found no active locks or interrupted runs.',
			facts: [
				{ label: 'Active lock', value: payload.lock.active ? 'yes' : 'no' },
				{ label: 'Stale lock', value: payload.lock.stale ? 'yes' : 'no' },
				{ label: 'Interrupted runs', value: payload.interruptedRuns.length },
				{ label: 'Stale runs', value: payload.staleRuns?.length ?? 0 },
				{ label: 'Pruned runs', value: payload.prunedRuns?.length ?? 0 },
				{ label: 'Marked obsolete', value: markedObsolete?.runId ?? '(none)' },
				{ label: 'Recorded runs', value: payload.runCount },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
