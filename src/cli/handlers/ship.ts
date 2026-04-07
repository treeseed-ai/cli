import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { handleSave } from './save.js';
import { handleDeploy } from './deploy.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';

export const handleShip: TreeseedCommandHandler = async (invocation, context) => {
	const beforeState = resolveTreeseedWorkflowState(context.cwd);
	const saveResult = await handleSave({
		...invocation,
		commandName: 'save',
	}, context);
	if ((saveResult.exitCode ?? 0) !== 0) {
		return saveResult;
	}

	let previewRefresh: Record<string, unknown> | null = null;
	if (beforeState.branchRole === 'feature' && beforeState.preview.enabled && beforeState.branchName) {
		const publishResult = await handleDeploy({
			commandName: 'deploy',
			args: {
				targetBranch: beforeState.branchName,
				json: invocation.args.json,
			},
			positionals: [],
			rawArgs: ['--target-branch', beforeState.branchName, ...(invocation.args.json === true ? ['--json'] : [])],
		}, context);
		if ((publishResult.exitCode ?? 0) !== 0) {
			return publishResult;
		}
		previewRefresh = publishResult.report ?? null;
	}

	const afterState = resolveTreeseedWorkflowState(context.cwd);
	return guidedResult({
		command: 'ship',
		summary: 'Treeseed ship completed successfully.',
		facts: [
			{ label: 'Branch', value: afterState.branchName ?? beforeState.branchName ?? '(none)' },
			{ label: 'Branch role', value: afterState.branchRole },
			{ label: 'Preview refreshed', value: previewRefresh ? 'yes' : 'no' },
		],
		nextSteps: afterState.recommendations.map((item) => `${item.command}  # ${item.reason}`),
		report: {
			state: afterState,
			save: saveResult.report,
			previewRefresh,
		},
	});
};
