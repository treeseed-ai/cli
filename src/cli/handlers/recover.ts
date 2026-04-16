import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleRecover: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).recover({});
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
			runCount: number;
		};
		return guidedResult({
			command: 'recover',
			summary: payload.interruptedRuns.length > 0 || payload.lock.active
				? 'Treeseed recover found workflow state that may need attention.'
				: 'Treeseed recover found no active locks or interrupted runs.',
			facts: [
				{ label: 'Active lock', value: payload.lock.active ? 'yes' : 'no' },
				{ label: 'Stale lock', value: payload.lock.stale ? 'yes' : 'no' },
				{ label: 'Interrupted runs', value: payload.interruptedRuns.length },
				{ label: 'Recorded runs', value: payload.runCount },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
