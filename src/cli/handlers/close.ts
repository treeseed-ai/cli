import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleClose: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).close({
			message: invocation.positionals.join(' ').trim(),
		});
		const payload = result.payload as {
			branchName: string;
			message: string;
			deprecatedTag: { tagName: string };
			previewCleanup: { performed: boolean };
		};
		return guidedResult({
			command: invocation.commandName || 'close',
			summary: 'Treeseed close completed successfully.',
			facts: [
				{ label: 'Closed branch', value: payload.branchName },
				{ label: 'Deprecated tag', value: payload.deprecatedTag.tagName },
				{ label: 'Preview cleanup', value: payload.previewCleanup.performed ? 'performed' : 'not needed' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: payload,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
