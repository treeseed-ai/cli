import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
	buildCliClientEncryptedEscrowBody,
	buildCliGitHubActionsSecretDeploymentBody,
	summarizeCliSecretCapabilityState,
} = await import('../../../../dist/cli/configuration/secrets-escrow.js');

test('CLI escrow helpers emit ciphertext-only API bodies', () => {
	const body = buildCliClientEncryptedEscrowBody({
		id: 'escrow-1',
		secretId: 'secret-1',
		name: 'TREESEED_PROJECT_SECRET',
		secretClass: 'customer_project_secret',
		ciphertext: 'base64-ciphertext',
		ciphertextRef: 'api://projects/project-1/secrets/escrow/escrow-1',
		algorithm: 'xchacha20-poly1305',
		nonce: 'base64-nonce',
		salt: 'base64-salt',
		kdf: 'argon2id',
		kdfParams: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
		wrappingKeyId: 'client-key-1',
		encryptionVersion: 'v1',
		deploymentIntent: { targetMode: 'github_actions_secret_enclave' },
	});

	assert.equal(body.recoveryPolicy, 'reentry_required');
	assert.equal(body.ciphertext, 'base64-ciphertext');
	assert.doesNotMatch(JSON.stringify(body), /passphrase|derivedKey|rawSecret|secretValue/u);
	assert.throws(() => buildCliClientEncryptedEscrowBody({
		...body,
		passphrase: 'do-not-send',
	}));
});

test('CLI GitHub deployment helpers require encrypted GitHub payloads', () => {
	const body = buildCliGitHubActionsSecretDeploymentBody({
		repository: 'owner/repo',
		scope: 'environment',
		environment: 'production',
		secretName: 'TREESEED_SECRET',
		encryptedValue: 'github-encrypted-value',
		keyId: 'key-1',
	});

	assert.equal(body.custodyMode, 'github_actions_secret_enclave');
	assert.equal(body.encryptedValue, 'github-encrypted-value');
	assert.throws(() => buildCliGitHubActionsSecretDeploymentBody({
		...body,
		secretValue: 'do-not-send',
	}));
});

test('CLI secret capability summaries classify safe custody states', () => {
	assert.deepEqual(summarizeCliSecretCapabilityState({
		custodyMode: 'github_actions_secret_enclave',
		githubSecretTarget: { repository: 'owner/repo', secretName: 'TREESEED_SECRET' },
	}).githubBacked, true);
	assert.equal(summarizeCliSecretCapabilityState({
		custodyMode: 'host_env_injection',
	}).hostInjected, true);
	assert.equal(summarizeCliSecretCapabilityState({
		custodyMode: 'client_encrypted_escrow',
		id: 'escrow-1',
		secretId: 'secret-1',
		ciphertextRef: 'api://projects/project-1/secrets/escrow/escrow-1',
		algorithm: 'xchacha20-poly1305',
		wrappingKeyId: 'client-key-1',
		expiresAt: '2000-01-01T00:00:00.000Z',
	}).reentryRequired, true);
});
