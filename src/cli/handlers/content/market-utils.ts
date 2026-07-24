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
	const profile = resolveMarketProfile(marketSelector(invocation));
	const session = resolveMarketSession(marketAuthRoot(context), profile.id);
	const localAccessToken = options.allowLocalAcceptanceAdmin && profile.id === 'local'
		? localAcceptanceAdminToken(context.env)
		: null;
	const accessToken = localAccessToken ?? session?.accessToken ?? null;
	if (options.requireAuth && !accessToken) {
		throw new Error(`Not logged in to market "${profile.id}". Run treeseed auth:login --market ${profile.id}.`);
	}
	return {
		profile,
		session,
		client: new MarketClient({
			profile,
			accessToken,
			userAgent: 'treeseed-cli',
		}),
	};
}

export function formatMarketProfile(profile: MarketProfile) {
	return `${profile.id}  ${profile.baseUrl}  ${profile.kind}${profile.teamId ? `  team=${profile.teamId}` : ''}`;
}
