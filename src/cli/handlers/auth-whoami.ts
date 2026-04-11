import type { TreeseedCommandHandler } from '../types.js';
import { RemoteTreeseedAuthClient, RemoteTreeseedClient } from '@treeseed/sdk/remote';
import { resolveTreeseedRemoteConfig } from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';

export const handleAuthWhoAmI: TreeseedCommandHandler = async (_invocation, context) => {
	const remoteConfig = resolveTreeseedRemoteConfig(context.cwd, context.env);
	const client = new RemoteTreeseedAuthClient(new RemoteTreeseedClient(remoteConfig));
	const response = await client.whoAmI();
	return guidedResult({
		command: 'auth:whoami',
		summary: 'Treeseed API identity',
		facts: [
			{ label: 'Host', value: remoteConfig.activeHostId },
			{ label: 'Principal', value: response.payload.displayName ?? response.payload.id },
			{ label: 'Scopes', value: response.payload.scopes.join(', ') },
		],
		report: {
			hostId: remoteConfig.activeHostId,
			principal: response.payload,
		},
	});
};
