import type { TreeseedCommandHandler } from '../types.js';
import {
	setMarketSession,
} from '@treeseed/sdk/market-client';
import { TreeseedKeyAgentError } from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';
import { createMarketClientForInvocation, marketAuthRoot } from './market-utils.js';

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const handleAuthLogin: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const tenantRoot = marketAuthRoot(context);
		const { profile, client } = createMarketClientForInvocation(invocation, context);
		const started = await client.startDeviceLogin({
			clientName: 'treeseed-cli',
			scopes: ['auth:me', 'market'],
		});

		if (context.outputFormat !== 'json') {
			context.write(`Open ${started.verificationUriComplete}`, 'stdout');
			context.write(`User code: ${started.userCode}`, 'stdout');
			context.write('Waiting for approval...', 'stdout');
		}

		const deadline = Date.parse(started.expiresAt);
		while (Date.now() < deadline) {
			const response = await client.pollDeviceLogin({ deviceCode: started.deviceCode });
			if (response.ok && response.status === 'approved') {
				setMarketSession(tenantRoot, {
					marketId: profile.id,
					accessToken: response.accessToken,
					refreshToken: response.refreshToken,
					expiresAt: response.expiresAt,
					principal: response.principal,
				});
				return guidedResult({
					command: 'auth:login',
					summary: 'Treeseed API login completed successfully.',
					facts: [
						{ label: 'Market', value: profile.id },
						{ label: 'URL', value: profile.baseUrl },
						{ label: 'Principal', value: response.principal.displayName ?? response.principal.id },
						{ label: 'Scopes', value: response.principal.scopes.join(', ') },
					],
					report: {
						marketId: profile.id,
						baseUrl: profile.baseUrl,
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
