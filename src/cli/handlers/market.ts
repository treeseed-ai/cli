import {
	addMarketProfile,
	loadMarketRegistryState,
	removeMarketProfile,
	setActiveMarketProfile,
} from '@treeseed/sdk/market-client';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createMarketClientForInvocation, formatMarketProfile } from './market-utils.js';

export const handleMarket: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	if (action === 'list') {
		const state = loadMarketRegistryState();
		return guidedResult({
			command: 'market',
			summary: 'Configured Treeseed markets',
			sections: [{
				title: 'Markets',
				lines: state.profiles.map((profile) => `${profile.id === state.activeMarketId ? '*' : ' '} ${formatMarketProfile(profile)}`),
			}],
			report: state as unknown as Record<string, unknown>,
		});
	}
	if (action === 'add') {
		const id = invocation.positionals[1];
		const baseUrl = invocation.positionals[2];
		if (!id || !baseUrl) {
			return { exitCode: 1, stderr: ['Usage: treeseed market add <id> <url>'] };
		}
		const state = addMarketProfile({
			id,
			label: typeof invocation.args.label === 'string' ? invocation.args.label : id,
			baseUrl,
			kind: invocation.args.kind === 'central' ? 'central' : 'specialized',
			teamId: typeof invocation.args.team === 'string' ? invocation.args.team : null,
			alwaysAvailable: invocation.args.kind === 'central',
		});
		return guidedResult({
			command: 'market',
			summary: `Added market "${id}".`,
			report: state as unknown as Record<string, unknown>,
		});
	}
	if (action === 'remove') {
		const id = invocation.positionals[1];
		if (!id) return { exitCode: 1, stderr: ['Usage: treeseed market remove <id>'] };
		const state = removeMarketProfile(id);
		return guidedResult({
			command: 'market',
			summary: `Removed market "${id}".`,
			report: state as unknown as Record<string, unknown>,
		});
	}
	if (action === 'use') {
		const id = invocation.positionals[1];
		if (!id) return { exitCode: 1, stderr: ['Usage: treeseed market use <id>'] };
		const state = setActiveMarketProfile(id);
		return guidedResult({
			command: 'market',
			summary: `Active market is now "${id}".`,
			report: state as unknown as Record<string, unknown>,
		});
	}
	if (action === 'status') {
		const { profile, client, session } = createMarketClientForInvocation(invocation, context);
		const current = await client.currentMarket().catch(() => null);
		return guidedResult({
			command: 'market',
			summary: 'Treeseed market status',
			facts: [
				{ label: 'Market', value: profile.id },
				{ label: 'URL', value: profile.baseUrl },
				{ label: 'Kind', value: current?.payload.kind ?? profile.kind },
				{ label: 'Authenticated', value: Boolean(session?.accessToken) },
			],
			report: {
				market: current?.payload ?? profile,
				authenticated: Boolean(session?.accessToken),
			},
		});
	}
	return {
		exitCode: 1,
		stderr: [`Unknown market action: ${action}`],
	};
};
