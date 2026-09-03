import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SERVICE_VAULT_ENCRYPTION_VERSION, canonicalServiceVaultAssociatedData, clearServiceVaultKey,
	createServiceVaultKey, createServiceVaultUserKeyPair, createTeamVaultGrant, encryptServiceCredential,
	encryptServiceVaultPrivateKey, openSecretOperationPayload,
} from '@treeseed/sdk/secrets-capability';
import { completeHostedTopologyOperation } from '../../../../src/cli/commands/platform/hosted-vault.ts';

test('hosted topology authorization decrypts in process and sends only a sealed one-use payload', async () => {
	const teamId = 'team-1', connectionId = 'railway-staging', passphrase = 'correct horse battery staple';
	const userPair = await createServiceVaultUserKeyPair(), operationPair = await createServiceVaultUserKeyPair();
	const teamKey = await createServiceVaultKey();
	try {
		const privateEnvelope = await encryptServiceVaultPrivateKey(userPair.privateKey, userPair.publicKey, passphrase, { opsLimit: 2, memLimit: 67_108_864 });
		const grant = await createTeamVaultGrant(teamKey, userPair.publicKey), keyVersion = 1;
		const associatedData = canonicalServiceVaultAssociatedData({ teamId, connectionId,
			credentialProfileId: 'railway-workspace', field: 'apiToken', purpose: 'team-service-credential', version: keyVersion });
		const envelope = await encryptServiceCredential('railway-secret', teamKey, associatedData);
		let sealedPayload = '';
		const invoke = async (operation: any, input: any) => {
			const id = operation.descriptor.operationId;
			if (id === 'services.vault.user.key.show') return { data: { encryptedPrivateKeyEnvelope: privateEnvelope } };
			if (id === 'services.vault.team.show') return { data: { ownGrant: { wrappedTeamVaultKey: grant.wrappedTeamVaultKey } } };
			if (id === 'services.operation.leases.show') return { data: { id: 'lease-1', teamId, connectionId,
				credentialProfileId: 'railway-workspace', requiredFields: ['apiToken'], publicKey: operationPair.publicKey, status: 'pending' } };
			if (id === 'services.credential.envelopes.list') return { data: [{ definitionId: 'railway-workspace',
				credentialProfileId: 'profile-row-1', fieldKey: 'apiToken', keyVersion, envelope }] };
			if (id === 'services.operation.leases.payload.put') { sealedPayload = input.body.sealedPayload; return { data: { status: 'ready' } }; }
			if (id === 'operations.show') return { data: { status: 'completed', output: { plan: { planDigest: `sha256:${'a'.repeat(64)}` } } } };
			throw new Error(`Unexpected operation ${id}`);
		};
		const result = await completeHostedTopologyOperation({ operation: { id: 'operation-1' }, credentialLeases: [{ id: 'lease-1' }] },
			teamId, invoke, { cwd: '.', env: {}, write() {}, outputFormat: 'json', interactiveUi: false,
				readStdin: async () => `${passphrase}\n` });
		assert.deepEqual(result, { planDigest: `sha256:${'a'.repeat(64)}` });
		assert.deepEqual(await openSecretOperationPayload(sealedPayload, operationPair.publicKey, operationPair.privateKey),
			{ apiToken: 'railway-secret' });
		assert.equal(JSON.stringify(result).includes('railway-secret'), false);
	} finally {
		clearServiceVaultKey(teamKey);
		clearServiceVaultKey(userPair.privateKey);
		clearServiceVaultKey(operationPair.privateKey);
	}
});
