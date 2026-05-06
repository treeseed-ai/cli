import type { TreeseedCommandHandler } from '../types.js';
import { loadMarketRegistryState, resolveMarketSession } from '@treeseed/sdk/market-client';
import { TreeseedKeyAgentError } from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';
import { createMarketClientForInvocation, marketAuthRoot } from './market-utils.js';

export const handleAuthWhoAmI: TreeseedCommandHandler = async (invocation, context) => {
	try {
		if (invocation.args.allMarkets === true) {
			const tenantRoot = marketAuthRoot(context);
			const state = loadMarketRegistryState();
			const sessions = state.profiles.map((profile) => ({
				profile,
				session: resolveMarketSession(tenantRoot, profile.id),
			}));
			return guidedResult({
				command: 'auth:whoami',
				summary: 'Treeseed market identities',
				sections: [{
					title: 'Markets',
					lines: sessions.map(({ profile, session }) =>
						`${profile.id}: ${session?.principal?.displayName ?? session?.principal?.id ?? '(not logged in)'}`),
				}],
				report: {
					markets: sessions.map(({ profile, session }) => ({
						marketId: profile.id,
						baseUrl: profile.baseUrl,
						principal: session?.principal ?? null,
					})),
				},
			});
		}
		const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
		const response = await client.me();
		return guidedResult({
			command: 'auth:whoami',
			summary: 'Treeseed API identity',
			facts: [
				{ label: 'Market', value: profile.id },
				{ label: 'URL', value: profile.baseUrl },
				{ label: 'Principal', value: response.payload.principal.displayName ?? response.payload.principal.id },
				{ label: 'Scopes', value: response.payload.principal.scopes.join(', ') },
			],
			report: {
				marketId: profile.id,
				baseUrl: profile.baseUrl,
				principal: response.payload.principal,
				teams: response.payload.teams,
			},
		});
	} catch (error) {
		if (error instanceof TreeseedKeyAgentError) {
			return {
				exitCode: 1,
				stderr: [error.message],
				report: { command: 'auth:whoami', ok: false, code: error.code, details: error.details ?? null },
			};
		}
		throw error;
	}
};
