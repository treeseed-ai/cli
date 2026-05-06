import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
	MarketClient,
	resolveMarketProfile,
	resolveMarketSession,
	type MarketProfile,
} from '@treeseed/sdk/market-client';
import { findNearestTreeseedRoot } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';

export function marketAuthRoot(context: TreeseedCommandContext) {
	return findNearestTreeseedRoot(context.cwd) ?? resolve(context.env.HOME || homedir());
}

export function marketSelector(invocation: TreeseedParsedInvocation) {
	return typeof invocation.args.market === 'string'
		? invocation.args.market
		: typeof invocation.args.host === 'string'
			? invocation.args.host
			: null;
}

export function createMarketClientForInvocation(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext, options: { requireAuth?: boolean } = {}) {
	const profile = resolveMarketProfile(marketSelector(invocation));
	const session = resolveMarketSession(marketAuthRoot(context), profile.id);
	if (options.requireAuth && !session?.accessToken) {
		throw new Error(`Not logged in to market "${profile.id}". Run treeseed auth:login --market ${profile.id}.`);
	}
	return {
		profile,
		session,
		client: new MarketClient({
			profile,
			accessToken: session?.accessToken ?? null,
			userAgent: 'treeseed-cli',
		}),
	};
}

export function formatMarketProfile(profile: MarketProfile) {
	return `${profile.id}  ${profile.baseUrl}  ${profile.kind}${profile.teamId ? `  team=${profile.teamId}` : ''}`;
}
