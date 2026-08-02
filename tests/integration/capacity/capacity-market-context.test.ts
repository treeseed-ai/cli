import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCapacityTeam } from '../../../src/cli/handlers/capacity/capacity-core/capacity-market-context.ts';

describe('capacity team resolution', () => {
	it('resolves a public slug profile through authenticated principal team metadata', async () => {
		const client = {
			request: async (path: string) => path === '/v1/me'
				? { ok: true, payload: { principal: { metadata: { teamId: 'team-123', teamName: 'treeseed' } }, teams: [] } }
				: { ok: true, payload: { team: { name: 'treeseed' }, knowledge: {} } },
		};
		const resolved = await resolveCapacityTeam(client, 'treeseed');
		assert.equal(resolved.teamId, 'team-123');
	});

	it('fails closed to the selector when authenticated identity cannot prove the team id', async () => {
		const client = {
			request: async (path: string) => path === '/v1/me'
				? { ok: true, payload: { principal: { metadata: {} }, teams: [] } }
				: { ok: true, payload: { team: { name: 'treeseed' }, knowledge: {} } },
		};
		const resolved = await resolveCapacityTeam(client, 'treeseed');
		assert.equal(resolved.teamId, 'treeseed');
		assert.equal(resolved.team, null);
	});
});
