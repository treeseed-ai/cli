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
				{ label: 'Package mode', value: state.packageSync.mode },
				{ label: 'Full package checkout', value: state.packageSync.completeCheckout ? 'yes' : 'no' },
				{ label: 'Package branch aligned', value: state.packageSync.aligned ? 'yes' : 'no' },
				{ label: 'Dirty package repos', value: state.packageSync.dirty ? 'yes' : 'no' },
				{ label: 'Package blockers', value: state.packageSync.blockers.length > 0 ? state.packageSync.blockers.join(' | ') : '(none)' },
				{ label: 'Local state', value: state.persistentEnvironments.local.phase },
				{ label: 'Staging state', value: state.persistentEnvironments.staging.phase },
				{ label: 'Prod state', value: state.persistentEnvironments.prod.phase },
				{ label: 'Local initialized', value: state.persistentEnvironments.local.initialized ? 'yes' : 'no' },
				{ label: 'Staging initialized', value: state.persistentEnvironments.staging.initialized ? 'yes' : 'no' },
				{ label: 'Prod initialized', value: state.persistentEnvironments.prod.initialized ? 'yes' : 'no' },
				{ label: 'Staging blockers', value: state.persistentEnvironments.staging.blockers.length > 0 ? state.persistentEnvironments.staging.blockers.join(' | ') : '(none)' },
				{ label: 'Prod blockers', value: state.persistentEnvironments.prod.blockers.length > 0 ? state.persistentEnvironments.prod.blockers.join(' | ') : '(none)' },
				{ label: 'Preview enabled', value: state.preview.enabled ? 'yes' : 'no' },
				{ label: 'Preview URL', value: state.preview.url ?? '(none)' },
				{ label: 'GitHub token/config', value: state.auth.gh ? 'configured' : 'missing' },
				{ label: 'Cloudflare token/config', value: state.auth.wrangler ? 'configured' : 'missing' },
				{ label: 'Railway token/config', value: state.auth.railway ? 'configured' : 'missing' },
				{ label: 'Remote API auth', value: state.auth.remoteApi ? 'ready' : 'not ready' },
				{ label: 'Wrapped machine key', value: state.secrets.wrappedKeyPresent ? 'present' : 'missing' },
				{ label: 'Key migration', value: state.secrets.migrationRequired ? 'required' : 'not needed' },
				{ label: 'Key agent', value: state.secrets.keyAgentRunning ? (state.secrets.keyAgentUnlocked ? 'running/unlocked' : 'running/locked') : 'stopped' },
				{ label: 'Startup passphrase env', value: state.secrets.startupPassphraseConfigured ? 'configured' : 'unset' },
				{ label: 'Market project', value: state.marketConnection.projectSlug ?? state.marketConnection.projectId ?? '(not paired)' },
				{ label: 'Market team', value: state.marketConnection.teamSlug ?? state.marketConnection.teamId ?? '(not paired)' },
				{ label: 'Market mode', value: state.marketConnection.connectionMode ?? '(not paired)' },
				{ label: 'Hub mode', value: state.marketConnection.hubMode ?? '(unknown)' },
				{ label: 'Runtime mode', value: state.marketConnection.runtimeMode ?? '(unknown)' },
				{ label: 'Runtime registration', value: state.marketConnection.runtimeRegistration ?? '(none)' },
				{ label: 'Runtime ready', value: state.marketConnection.runtimeReady ? 'yes' : 'no' },
				{ label: 'Web cache host', value: state.webCache.webHost ?? '(none)' },
				{ label: 'Content cache host', value: state.webCache.contentHost ?? '(none)' },
				{ label: 'Source page cache', value: state.webCache.sourcePagePolicy ?? '(none)' },
				{ label: 'Content page cache', value: state.webCache.contentPagePolicy ?? '(none)' },
				{ label: 'R2 object cache', value: state.webCache.r2ObjectPolicy ?? '(none)' },
				{ label: 'Cloudflare cache rules', value: state.webCache.cloudflareRulesManaged ? 'managed' : 'not managed' },
				{ label: 'Last deploy purge', value: state.webCache.lastDeployPurgeAt ? `${state.webCache.lastDeployPurgeAt} (${state.webCache.lastDeployPurgeCount ?? 0} urls)` : '(none)' },
				{ label: 'Last content purge', value: state.webCache.lastContentPurgeAt ? `${state.webCache.lastContentPurgeAt} (${state.webCache.lastContentPurgeCount ?? 0} urls)` : '(none)' },
				{ label: 'Current workstream', value: state.marketConnection.currentWorkstreamId ?? '(none)' },
				{ label: 'Approval blockers', value: state.marketConnection.approvalBlockers.length > 0 ? state.marketConnection.approvalBlockers.join(' | ') : '(none)' },
				{ label: 'API service', value: state.managedServices.api.enabled ? `${state.managedServices.api.initialized ? 'deployed' : 'not deployed'}${state.managedServices.api.lastDeployedUrl ? ` (${state.managedServices.api.lastDeployedUrl})` : ''}` : 'disabled' },
				{ label: 'Worker service', value: state.managedServices.worker.enabled ? `${state.managedServices.worker.initialized ? 'deployed' : 'not deployed'}${state.managedServices.worker.lastDeployedUrl ? ` (${state.managedServices.worker.lastDeployedUrl})` : ''}` : 'disabled' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: {
				...result,
				state,
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
