import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeedPlan } from '@treeseed/sdk/seeds';
import { localRuntimePlan } from '../../../src/cli/handlers/seeds/seed.ts';

test('local seed runtime keeps caller-owned prerequisites after API apply', () => {
	const planned = {
		runtime: { capacityProviders: [{ key: 'current-provider' }], agentLabServicePrincipals: [] },
	} as unknown as SeedPlan;
	const applied = {
		actions: [{ key: 'project:resolved', existing: { id: 'project-id' } }],
		runtime: { capacityProviders: [{ key: 'stale-provider' }], agentLabServicePrincipals: [] },
	} as unknown as SeedPlan;

	const result = localRuntimePlan(planned, applied);
	assert.equal(result.runtime.capacityProviders[0]?.key, 'current-provider');
	assert.equal(result.actions[0]?.existing?.id, 'project-id');
});
