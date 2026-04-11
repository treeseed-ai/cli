import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';

export const handleContinue: TreeseedCommandHandler = (_invocation, context) => {
	const state = resolveTreeseedWorkflowState(context.cwd);
	const next = state.recommendations[0] ?? null;
	return guidedResult({
		command: 'continue',
		summary: next ? 'Treeseed selected the safest next workflow step.' : 'Treeseed could not infer a next workflow step.',
		facts: [
			{ label: 'Branch', value: state.branchName ?? '(none)' },
			{ label: 'Suggested command', value: next?.command ?? '(none)' },
		],
		nextSteps: next ? [`${next.command}  # ${next.reason}`] : ['treeseed doctor'],
		report: {
			state,
			selected: next,
		},
		exitCode: next ? 0 : 1,
	});
};
