import type { TreeseedCommandHandler } from '../types.js';
import {
	assertCleanWorktree,
	branchExists,
	checkoutBranch,
	currentManagedBranch,
	ensureLocalBranchTracking,
	gitWorkflowRoot,
	remoteBranchExists,
	syncBranchWithOrigin,
} from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';
import { provisionBranchPreview } from './start.js';
import { handleStart } from './start.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';

export const handleWork: TreeseedCommandHandler = async (invocation, context) => {
	const commandName = invocation.commandName || 'work';
	const branchName = invocation.positionals[0];
	const preview = invocation.args.preview === true;
	const repoDir = gitWorkflowRoot(context.cwd);
	const currentBranch = currentManagedBranch(context.cwd);

	if (currentBranch === branchName) {
		const state = resolveTreeseedWorkflowState(context.cwd);
		if (preview && !state.preview.enabled) {
			return provisionBranchPreview(branchName, context, commandName);
		}
		return guidedResult({
			command: commandName,
			summary: `Already working on ${branchName}.`,
			facts: [
				{ label: 'Branch', value: branchName },
				{ label: 'Preview', value: state.preview.enabled ? 'enabled' : 'disabled' },
				{ label: 'Preview URL', value: state.preview.url ?? '(none)' },
			],
			nextSteps: [
				preview && !state.preview.enabled ? `treeseed work ${branchName} --preview` : 'treeseed dev',
				'treeseed ship "describe your change"',
			],
			report: {
				branchName,
				resumed: true,
				preview: state.preview.enabled,
				previewUrl: state.preview.url,
			},
		});
	}

	if (!branchExists(repoDir, branchName) && !remoteBranchExists(repoDir, branchName)) {
		return handleStart({
			...invocation,
			commandName,
		}, context);
	}

	assertCleanWorktree(context.cwd);
	ensureLocalBranchTracking(repoDir, branchName);
	checkoutBranch(repoDir, branchName);
	syncBranchWithOrigin(repoDir, branchName);

	if (preview) {
		const state = resolveTreeseedWorkflowState(context.cwd);
		if (!state.preview.enabled) {
			return provisionBranchPreview(branchName, context, commandName);
		}
	}

	const state = resolveTreeseedWorkflowState(context.cwd);
	return guidedResult({
		command: commandName,
		summary: `Resumed feature branch ${branchName}.`,
		facts: [
			{ label: 'Branch', value: branchName },
			{ label: 'Preview', value: state.preview.enabled ? 'enabled' : 'disabled' },
			{ label: 'Preview URL', value: state.preview.url ?? '(none)' },
		],
		nextSteps: [
			state.preview.enabled ? `treeseed publish --target-branch ${branchName}` : 'treeseed dev',
			'treeseed ship "describe your change"',
		],
		report: {
			branchName,
			resumed: true,
			preview: state.preview.enabled,
			previewUrl: state.preview.url,
		},
	});
};
