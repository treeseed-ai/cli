import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleSave: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).save({
			message: invocation.positionals.join(' ').trim(),
			hotfix: invocation.args.hotfix === true,
			preview: invocation.args.preview === true,
		});
		const payload = result.payload as {
			branch: string;
			scope: string;
			hotfix: boolean;
			message: string;
			commitSha: string;
			commitCreated: boolean;
			noChanges: boolean;
			previewAction: { status: string };
		};
		return guidedResult({
			command: invocation.commandName || 'save',
			summary: payload.noChanges ? 'Treeseed save found no new changes and confirmed branch sync.' : 'Treeseed save completed successfully.',
			facts: [
				{ label: 'Branch', value: payload.branch },
				{ label: 'Environment scope', value: payload.scope },
				{ label: 'Hotfix', value: payload.hotfix ? 'yes' : 'no' },
				{ label: 'Commit', value: payload.commitSha.slice(0, 12) },
				{ label: 'Commit created', value: payload.commitCreated ? 'yes' : 'no' },
				{ label: 'Preview action', value: payload.previewAction?.status ?? 'skipped' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: payload,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
