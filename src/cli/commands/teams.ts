import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';
import { saveActiveTeam } from '../support/server-custody.js';

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

function teamRows(value: unknown) {
	const envelope = record(value); const data = record(envelope.data); const source = Object.keys(data).length ? data : envelope;
	const values = Array.isArray(source.items) ? source.items : Array.isArray(source.teams) ? source.teams : Array.isArray(value) ? value : [];
	return values.map(record).flatMap((team) => {
		const id = String(team.id ?? '').trim(); const slug = String(team.slug ?? '').trim(); const name = String(team.name ?? team.displayName ?? slug).trim();
		return id && slug ? [{ id, slug, name }] : [];
	});
}

async function accessibleTeams(invocation: ParsedInvocation, context: CommandContext) {
	if (context.operationInvoke) return teamRows(await context.operationInvoke('teams.list', { path: {}, query: { limit: 500 }, body: undefined }));
	const { client } = await createControlPlaneClient(invocation, context, true);
	return teamRows(await client.invoke(CONTROL_PLANE_OPERATIONS.teams.list, { path: {}, query: { limit: 500 }, body: undefined }));
}

export async function runTeams(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.options.plan === true && invocation.command.name === 'teams use') return { action: 'teams use', team: invocation.arguments[0], mutation: false, authority: 'local_session_context' };
	const { profile, session } = await createControlPlaneClient(invocation, context, true);
	const teams = await accessibleTeams(invocation, context);
	if (invocation.command.name === 'teams current') {
		const active = session?.activeTeam;
		if (!active) throw Object.assign(new Error('No active team is selected. Run trsd teams use <team>.'), { category: 'ambiguous_context', code: 'active_team_required' });
		const current = teams.find((team) => team.id === active.id);
		if (!current) throw Object.assign(new Error(`The active team ${active.slug} is no longer accessible. Run trsd teams use <team>.`), { category: 'authorization_denied', code: 'active_team_stale' });
		return { serverId: profile.serverId, team: current };
	}
	if (invocation.command.name === 'teams use') {
		const selector = String(invocation.arguments[0] ?? '').trim().toLowerCase();
		const matches = teams.filter((team) => team.id.toLowerCase() === selector || team.slug.toLowerCase() === selector);
		if (!matches.length) throw Object.assign(new Error(`Team ${selector} is not accessible.`), { category: 'not_found', code: 'team_not_found' });
		if (matches.length > 1) throw Object.assign(new Error(`Team ${selector} is ambiguous.`), { category: 'ambiguous_context', code: 'team_ambiguous' });
		return { serverId: profile.serverId, team: saveActiveTeam(profile.serverId, matches[0]!, context.env) };
	}
	throw new Error(`Unknown team context command: ${invocation.command.name}`);
}
