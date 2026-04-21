import type { TreeseedCommandHandler } from '../types.js';
import { RemoteTreeseedAuthClient, RemoteTreeseedClient } from '@treeseed/sdk/remote';
import {
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
	TreeseedKeyAgentError,
} from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const handleAuthLogin: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const tenantRoot = context.cwd;
		const remoteConfig = resolveTreeseedRemoteConfig(tenantRoot, context.env);
		const hostId = typeof invocation.args.host === 'string' ? invocation.args.host : remoteConfig.activeHostId;
		const client = new RemoteTreeseedAuthClient(new RemoteTreeseedClient({
			...remoteConfig,
			activeHostId: hostId,
		}));
		const started = await client.startDeviceFlow({
			clientName: 'treeseed-cli',
			scopes: ['auth:me', 'sdk', 'operations'],
		});

		if (context.outputFormat !== 'json') {
			context.write(`Open ${started.verificationUriComplete}`, 'stdout');
			context.write(`User code: ${started.userCode}`, 'stdout');
			context.write('Waiting for approval...', 'stdout');
		}

		const deadline = Date.parse(started.expiresAt);
		while (Date.now() < deadline) {
			const response = await client.pollDeviceFlow({ deviceCode: started.deviceCode });
			if (response.ok && response.status === 'approved') {
				setTreeseedRemoteSession(tenantRoot, {
					hostId,
					accessToken: response.accessToken,
					refreshToken: response.refreshToken,
					expiresAt: response.expiresAt,
					principal: response.principal,
				});
				return guidedResult({
					command: 'auth:login',
					summary: 'Treeseed API login completed successfully.',
					facts: [
						{ label: 'Host', value: hostId },
						{ label: 'Principal', value: response.principal.displayName ?? response.principal.id },
						{ label: 'Scopes', value: response.principal.scopes.join(', ') },
					],
					report: {
						hostId,
						principal: response.principal,
					},
				});
			}
			if (!response.ok && response.status !== 'already_used') {
				return {
					exitCode: 1,
					stderr: [response.error],
				};
			}
			await sleep(started.intervalSeconds * 1000);
		}

		return {
			exitCode: 1,
			stderr: ['Treeseed API login expired before approval completed.'],
		};
	} catch (error) {
		if (error instanceof TreeseedKeyAgentError) {
			return {
				exitCode: 1,
				stderr: [error.message],
				report: { command: 'auth:login', ok: false, code: error.code, details: error.details ?? null },
			};
		}
		throw error;
	}
};
