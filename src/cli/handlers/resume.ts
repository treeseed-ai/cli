import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleResume: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const runId = invocation.positionals[0] ?? '';
		const result = await createWorkflowSdk(context).resume({ runId });
		return guidedResult({
			command: invocation.commandName || 'resume',
			summary: `Resumed workflow run ${runId}.`,
			facts: [
				{ label: 'Run', value: result.runId ?? runId },
				{ label: 'Command', value: result.command },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
