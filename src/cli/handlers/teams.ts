import { setActiveMarketProfile } from '@treeseed/sdk/market-client';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createMarketClientForInvocation } from './market-utils.js';

export const handleTeams: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	if (action === 'list') {
		const response = await client.teams();
		return guidedResult({
			command: 'teams',
			summary: 'Treeseed market teams',
			sections: [{
				title: 'Teams',
				lines: response.payload.map((team: any) => `${team.id}  ${team.displayName ?? team.name ?? team.slug}`),
			}],
			report: { marketId: profile.id, teams: response.payload },
		});
	}
	if (action === 'use') {
		const teamId = invocation.positionals[1];
		if (!teamId) return { exitCode: 1, stderr: ['Usage: treeseed teams use <team-id>'] };
		const state = setActiveMarketProfile(profile.id);
		return guidedResult({
			command: 'teams',
			summary: `Selected team "${teamId}" for market "${profile.id}".`,
			report: { marketId: profile.id, teamId, registry: state },
		});
	}
	if (action === 'members') {
		const teamId = typeof invocation.args.team === 'string' ? invocation.args.team : invocation.positionals[1];
		if (!teamId) return { exitCode: 1, stderr: ['Usage: treeseed teams members <team-id>'] };
		const response = await client.teamMembers(teamId);
		return guidedResult({
			command: 'teams',
			summary: 'Treeseed market team members',
			sections: [{
				title: 'Members',
				lines: response.payload.map((member: any) => `${member.userId}  ${member.displayName ?? member.email ?? member.id}  ${(member.roles ?? []).join(', ')}`),
			}],
			report: { marketId: profile.id, teamId, members: response.payload },
		});
	}
	return { exitCode: 1, stderr: [`Unknown teams action: ${action}`] };
};
