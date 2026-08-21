import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
	MarketClient,
	resolveMarketProfile,
	resolveMarketSession,
	type MarketProfile,
} from '@treeseed/sdk/market-client';
import { findNearestRoot } from '@treeseed/sdk/workflow-support';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { assertMarketIntegrationEnabled } from './support/market-mode.js';

export function marketAuthRoot(context: CommandContext) {
	return findNearestRoot(context.cwd) ?? resolve(context.env.HOME || homedir());
}

export function marketSelector(invocation: ParsedInvocation) {
	return typeof invocation.args.market === 'string'
		? invocation.args.market
		: typeof invocation.args.host === 'string'
			? invocation.args.host
			: null;
}

export function localAcceptanceAdminToken(env: NodeJS.ProcessEnv) {
	return env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN?.trim() || 'tsk_local_treeseed_acceptance_admin';
}

export function createMarketClientForInvocation(invocation: ParsedInvocation, context: CommandContext, options: { requireAuth?: boolean; allowLocalAcceptanceAdmin?: boolean } = {}) {
	const explicitSelector = marketSelector(invocation);
	const selector = explicitSelector ?? (context.env.TREESEED_CONTROL_PLANE_MODE?.trim() === 'managed' ? 'local' : null);
	const profile = resolveMarketProfile(selector);
	assertMarketIntegrationEnabled(context.cwd, profile.id);
	const session = resolveMarketSession(marketAuthRoot(context), profile.id);
	const localAccessToken = options.allowLocalAcceptanceAdmin && profile.id === 'local'
		? localAcceptanceAdminToken(context.env)
		: null;
	const accessToken = localAccessToken ?? session?.accessToken ?? null;
	const configuredMode = context.env.TREESEED_CONTROL_PLANE_MODE?.trim();
	const controlPlaneMode = configuredMode === 'managed' || configuredMode === 'external' || configuredMode === 'market-passthrough'
		? configuredMode
		: 'market-passthrough';
	const marketBaseUrl = profile.id === 'treeseed'
		? profile.baseUrl
		: context.env.TREESEED_MARKET_API_BASE_URL?.trim() || profile.baseUrl;
	const configuredControlPlaneUrl = context.env.TREESEED_API_BASE_URL?.trim();
	if (controlPlaneMode !== 'market-passthrough' && !configuredControlPlaneUrl) {
		throw new Error(`Control-plane mode ${controlPlaneMode} requires TREESEED_API_BASE_URL.`);
	}
	const controlPlaneBaseUrl = controlPlaneMode === 'market-passthrough' ? marketBaseUrl : configuredControlPlaneUrl!;
	if (options.requireAuth && !accessToken) {
		throw new Error(`Not logged in to market "${profile.id}". Run trsd auth login --market ${profile.id}.`);
	}
	return {
		profile,
		session,
		client: new MarketClient({
			profile,
			marketBaseUrl,
			controlPlaneBaseUrl,
			controlPlaneMode,
			accessToken,
			userAgent: 'treeseed-cli',
		}),
	};
}

export function formatMarketProfile(profile: MarketProfile) {
	return `${profile.id}  ${profile.baseUrl}  ${profile.kind}${profile.teamId ? `  team=${profile.teamId}` : ''}`;
}
