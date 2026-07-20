import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { capacityMarketRequest, capacityRecordValue } from './capacity-values.js';

export function createCapacityMarketClient(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const resolved = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
	return { ...resolved, authMode: resolved.profile.id === 'local' ? 'local_acceptance_admin' : 'session' };
}

export async function resolveCapacityTeam(client: unknown, teamSelector: string) {
	const profile = await capacityMarketRequest<{ ok: boolean; payload?: Record<string, unknown> }>(client, `/v1/teams/by-name/${encodeURIComponent(teamSelector)}/profile`, { requireAuth: true }).catch(() => null);
	const payload = profile?.payload && typeof profile.payload === 'object' ? profile.payload : {};
	const team = capacityRecordValue(payload, 'team');
	if (team && typeof team === 'object') {
		const activity = capacityRecordValue(payload, 'activity');
		const projects = activity && typeof activity === 'object' && Array.isArray((activity as Record<string, unknown>).projects) ? (activity as Record<string, unknown>).projects as Array<Record<string, unknown>> : [];
		return { teamId: String((team as Record<string, unknown>).id ?? teamSelector), teamSelector, team, projects };
	}
	return { teamId: teamSelector, teamSelector, team: null, projects: [] as Array<Record<string, unknown>> };
}
