import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactCapacityOutputSecrets } from '../src/cli/handlers/capacity-output-security.ts';
import { DEFAULT_PROVIDER_CAPABILITIES } from '../src/cli/handlers/capacity-provider-governance.ts';

describe('capacity CLI output security', () => {
	it('redacts issued secrets while retaining safe refs and forensic metadata', () => {
		assert.deepEqual(redactCapacityOutputSecrets({
			registrationKeyRef: 'env://TEAM_KEY',
			generatedCredentialRef: 'data://secrets/team.credential',
			credentialId: 'credential-id',
			registrationKeyPrefix: 'tsrk_example',
			runtime: {
				accessToken: {
					id: 'token-id',
					accessToken: 'tspa_plaintext',
					credential: 'tspc_plaintext',
					authorization: { bearer: 'plaintext' },
					leaseToken: 'lease-plaintext',
					apiKey: 'api-plaintext',
					password: 'password-plaintext',
					expiresAt: '2026-07-17T05:00:00.000Z',
				},
			},
		}), {
			registrationKeyRef: 'env://TEAM_KEY',
			generatedCredentialRef: 'data://secrets/team.credential',
			credentialId: 'credential-id',
			registrationKeyPrefix: 'tsrk_example',
			runtime: {
				accessToken: {
					id: 'token-id',
					accessToken: '<redacted>',
					credential: '<redacted>',
					authorization: { bearer: '<redacted>' },
					leaseToken: '<redacted>',
					apiKey: '<redacted>',
					password: '<redacted>',
					expiresAt: '2026-07-17T05:00:00.000Z',
				},
			},
		});
	});
});

describe('capacity provider bootstrap policy', () => {
	it('advertises the runtime capability aliases required by synchronized agent classes', () => {
		assert.deepEqual(
			['agent_mode_run', 'repo_read', 'repo_write', 'repository_work']
				.filter((capability) => !DEFAULT_PROVIDER_CAPABILITIES.includes(capability as typeof DEFAULT_PROVIDER_CAPABILITIES[number])),
			[],
		);
	});
});
