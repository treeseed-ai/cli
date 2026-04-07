import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';

export const handleStatus: TreeseedCommandHandler = (_invocation, context) => {
	const state = resolveTreeseedWorkflowState(context.cwd);
	return guidedResult({
		command: 'status',
		summary: 'Treeseed workflow status',
		facts: [
			{ label: 'Workspace root', value: state.workspaceRoot ? 'yes' : 'no' },
			{ label: 'Tenant config present', value: state.deployConfigPresent ? 'yes' : 'no' },
			{ label: 'Branch', value: state.branchName ?? '(none)' },
			{ label: 'Branch role', value: state.branchRole },
			{ label: 'Mapped environment', value: state.environment },
			{ label: 'Dirty worktree', value: state.dirtyWorktree ? 'yes' : 'no' },
			{ label: 'Local initialized', value: state.persistentEnvironments.local.initialized ? 'yes' : 'no' },
			{ label: 'Staging initialized', value: state.persistentEnvironments.staging.initialized ? 'yes' : 'no' },
			{ label: 'Prod initialized', value: state.persistentEnvironments.prod.initialized ? 'yes' : 'no' },
			{ label: 'Preview enabled', value: state.preview.enabled ? 'yes' : 'no' },
			{ label: 'Preview URL', value: state.preview.url ?? '(none)' },
			{ label: 'GitHub auth', value: state.auth.gh ? 'ready' : 'not ready' },
			{ label: 'Wrangler auth', value: state.auth.wrangler ? 'ready' : 'not ready' },
		],
		nextSteps: state.recommendations.map((item) => `${item.command}  # ${item.reason}`),
		report: {
			state,
		},
	});
};
