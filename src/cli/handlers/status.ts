import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleStatus: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).status();
		const state = result.payload;
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
				{ label: 'GH_TOKEN', value: state.auth.gh ? 'ready' : 'missing' },
				{ label: 'CLOUDFLARE_API_TOKEN', value: state.auth.wrangler ? 'ready' : 'missing' },
				{ label: 'RAILWAY_API_TOKEN', value: state.auth.railway ? 'ready' : 'missing' },
				{ label: 'Remote API auth', value: state.auth.remoteApi ? 'ready' : 'not ready' },
				{ label: 'API service', value: state.managedServices.api.enabled ? `${state.managedServices.api.initialized ? 'initialized' : 'not initialized'}${state.managedServices.api.lastDeployedUrl ? ` (${state.managedServices.api.lastDeployedUrl})` : ''}` : 'disabled' },
				{ label: 'Agents service', value: state.managedServices.agents.enabled ? `${state.managedServices.agents.initialized ? 'initialized' : 'not initialized'}${state.managedServices.agents.lastDeployedUrl ? ` (${state.managedServices.agents.lastDeployedUrl})` : ''}` : 'disabled' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: {
				state,
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
