import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	resolveCapacityWorkdayProviderId,
	type CapacityWorkdayProviderClient,
} from '../../../src/cli/handlers/capacity/workdays/configuration/capacity-workday-provider.ts';

function client(input: { memberships?: unknown; sessions?: unknown }): CapacityWorkdayProviderClient {
	return {
		async capacityProviderMemberships() { return { payload: input.memberships ?? [] }; },
		async providerAvailabilitySessions() { return { payload: input.sessions ?? [] }; },
	};
}

describe('capacity workday provider resolution', () => {
	it('resolves an explicit global provider id only through an approved membership', async () => {
		const resolved = await resolveCapacityWorkdayProviderId(client({ memberships: [
			{ providerId: 'provider-approved', status: 'approved' },
			{ providerId: 'provider-revoked', status: 'revoked' },
		] }), 'team-a', 'provider-approved');
		assert.equal(resolved.providerId, 'provider-approved');
		assert.deepEqual(resolved.providers.map((provider) => provider.id), ['provider-approved']);
		await assert.rejects(
			resolveCapacityWorkdayProviderId(client({ memberships: [{ providerId: 'provider-revoked', status: 'revoked' }] }), 'team-a', 'provider-revoked'),
			/did not match an approved/u,
		);
	});

	it('maps local to the sole approved provider with an open local session', async () => {
		const resolved = await resolveCapacityWorkdayProviderId(client({
			memberships: { items: [
				{ providerId: 'provider-local', status: 'approved' },
				{ providerId: 'provider-hosted', status: 'approved' },
			] },
			sessions: { items: [
				{ providerId: 'provider-local', status: 'open', environment: 'local' },
				{ providerId: 'provider-hosted', status: 'open', environment: 'staging' },
			] },
		}), 'team-a', 'local');
		assert.equal(resolved.providerId, 'provider-local');
	});

	it('fails closed when local is ambiguous', async () => {
		await assert.rejects(resolveCapacityWorkdayProviderId(client({
			memberships: [
				{ providerId: 'provider-a', status: 'approved' },
				{ providerId: 'provider-b', status: 'approved' },
			],
			sessions: [
				{ providerId: 'provider-a', status: 'open', environment: 'local' },
				{ providerId: 'provider-b', status: 'open', environment: 'local' },
			],
		}), 'team-a', 'local'), /ambiguous/u);
	});

	it('never returns the literal local selector as a provider identity', async () => {
		await assert.rejects(resolveCapacityWorkdayProviderId(client({
			memberships: [
				{ providerId: 'provider-a', status: 'approved' },
				{ providerId: 'provider-b', status: 'approved' },
			],
		}), 'team-a', 'local'), /did not match/u);
	});
});
