import type { TreeseedCommandHandler } from '../types.js';
import {
	clearTreeseedRemoteSession,
	resolveTreeseedRemoteConfig,
	TreeseedKeyAgentError,
} from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';

export const handleAuthLogout: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const tenantRoot = context.cwd;
		const remoteConfig = resolveTreeseedRemoteConfig(tenantRoot, context.env);
		const hostId = typeof invocation.args.host === 'string' ? invocation.args.host : remoteConfig.activeHostId;
		clearTreeseedRemoteSession(tenantRoot, hostId);
		return guidedResult({
			command: 'auth:logout',
			summary: 'Cleared the local Treeseed API session.',
			facts: [{ label: 'Host', value: hostId }],
			report: { hostId },
		});
	} catch (error) {
		if (error instanceof TreeseedKeyAgentError) {
			return {
				exitCode: 1,
				stderr: [error.message],
				report: { command: 'auth:logout', ok: false, code: error.code, details: error.details ?? null },
			};
		}
		throw error;
	}
};
