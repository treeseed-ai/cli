import type { CommandHandler } from '../../types.js';
import {
	KeyAgentError,
} from '@treeseed/sdk/workflow-support';
import { clearMarketSession } from '@treeseed/sdk/market-client';
import { guidedResult } from '../utilities/utils.js';
import { createMarketClientForInvocation, marketAuthRoot } from '../content/market-utils.js';

export const handleAuthLogout: CommandHandler = async (invocation, context) => {
	try {
		const tenantRoot = marketAuthRoot(context);
		const { profile, client, session } = createMarketClientForInvocation(invocation, context);
		if (session?.accessToken) {
			await client.logout().catch(() => null);
		}
		clearMarketSession(tenantRoot, profile.id);
		return guidedResult({
			command: 'auth:logout',
			summary: 'Cleared the local Treeseed API session.',
			facts: [
				{ label: 'Market', value: profile.id },
				{ label: 'URL', value: profile.baseUrl },
			],
			report: { marketId: profile.id, baseUrl: profile.baseUrl },
		});
	} catch (error) {
		if (error instanceof KeyAgentError) {
			return {
				exitCode: 1,
				stderr: [error.message],
				report: { command: 'auth:logout', ok: false, code: error.code, details: error.details ?? null },
			};
		}
		throw error;
	}
};
