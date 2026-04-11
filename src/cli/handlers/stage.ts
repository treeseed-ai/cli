import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleStage: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).stage({
			message: invocation.positionals.join(' ').trim(),
		});
		const payload = result.payload as {
			branchName: string;
			mergeTarget: string;
			deprecatedTag: { tagName: string };
			stagingWait: { status: string };
			previewCleanup: { performed: boolean };
		};
		return guidedResult({
			command: invocation.commandName || 'stage',
			summary: 'Treeseed stage completed successfully.',
			facts: [
				{ label: 'Merged branch', value: payload.branchName },
				{ label: 'Merge target', value: payload.mergeTarget },
				{ label: 'Deprecated tag', value: payload.deprecatedTag.tagName },
				{ label: 'Staging wait', value: payload.stagingWait.status },
				{ label: 'Preview cleanup', value: payload.previewCleanup.performed ? 'performed' : 'not needed' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: payload,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
