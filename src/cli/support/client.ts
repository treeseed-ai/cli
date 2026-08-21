import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { MarketClient, resolveMarketProfile, resolveMarketSession } from '@treeseed/sdk/market-client';
import { findNearestRoot } from '@treeseed/sdk/workflow-support';
import type { CommandContext, ParsedInvocation } from '../types.js';

export function sessionRoot(context: CommandContext) {
	return findNearestRoot(context.cwd) ?? resolve(context.env.HOME || homedir());
}

export function createControlPlaneClient(invocation: Pick<ParsedInvocation, 'options'>, context: CommandContext, requireAuth = true) {
	const selector = typeof invocation.options.market === 'string' ? invocation.options.market : 'local';
	const profile = resolveMarketProfile(selector);
	const session = resolveMarketSession(sessionRoot(context), profile.id);
	if (requireAuth && !session?.accessToken) throw new Error(`Not logged in to ${profile.id}. Run trsd auth login --market ${profile.id}.`);
	const mode = context.env.TREESEED_CONTROL_PLANE_MODE === 'external' ? 'external' : 'managed';
	const controlPlaneBaseUrl = context.env.TREESEED_API_BASE_URL?.trim() ?? (mode === 'managed' ? 'http://127.0.0.1:3002' : null);
	if (!controlPlaneBaseUrl) throw new Error('External control-plane mode requires TREESEED_API_BASE_URL.');
	return {
		profile,
		session,
		client: new MarketClient({ profile, marketBaseUrl: profile.baseUrl, controlPlaneBaseUrl, controlPlaneMode: mode, accessToken: session?.accessToken ?? null, userAgent: 'trsd' }),
	};
}
