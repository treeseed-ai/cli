import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleSwitch: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const branch = invocation.positionals[0];
		const result = await createWorkflowSdk(context).switchTask({
			branch,
			preview: invocation.args.preview === true,
		});
		const payload = result.payload as {
			branchName: string;
			created: boolean;
			resumed: boolean;
			preview: { enabled: boolean; url: string | null };
		};
		return guidedResult({
			command: invocation.commandName || 'switch',
			summary: payload.created
				? `Created task branch ${payload.branchName}.`
				: payload.resumed
					? `Switched to task branch ${payload.branchName}.`
					: `Task branch ${payload.branchName} is ready.`,
			facts: [
				{ label: 'Branch', value: payload.branchName },
				{ label: 'Created', value: payload.created ? 'yes' : 'no' },
				{ label: 'Preview', value: payload.preview.enabled ? 'enabled' : 'disabled' },
				{ label: 'Preview URL', value: payload.preview.url ?? '(none)' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: payload,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
