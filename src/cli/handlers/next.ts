import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';

export const handleNext: TreeseedCommandHandler = (_invocation, context) => {
	const state = resolveTreeseedWorkflowState(context.cwd);
	return guidedResult({
		command: 'next',
		summary: 'Treeseed next-step recommendations',
		facts: [
			{ label: 'Branch', value: state.branchName ?? '(none)' },
			{ label: 'Branch role', value: state.branchRole },
			{ label: 'Dirty worktree', value: state.dirtyWorktree ? 'yes' : 'no' },
		],
		nextSteps: state.recommendations.map((item) => `${item.command}  # ${item.reason}`),
		report: {
			state: {
				branchName: state.branchName,
				branchRole: state.branchRole,
				dirtyWorktree: state.dirtyWorktree,
				environment: state.environment,
			},
			recommendations: state.recommendations,
		},
	});
};
