import {
	SERVICE_VAULT_ENCRYPTION_VERSION,
	canonicalServiceVaultAssociatedData,
	clearServiceVaultKey,
	decryptServiceCredential,
	decryptServiceVaultPrivateKey,
	openTeamVaultGrant,
	sealSecretOperationPayload,
} from '@treeseed/sdk/secrets-capability';
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext } from '../../types.js';
import { promptHidden } from '../../support/prompts.js';

type Invoke = (operation: any, input: unknown, mutation?: boolean) => Promise<unknown>;
const value = (response: unknown) => response && typeof response === 'object' && !Array.isArray(response) && 'data' in response
	? (response as { data: unknown }).data : response;
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForLease(teamId: string, lease: any, invoke: Invoke) {
	const operation = CONTROL_PLANE_OPERATIONS.services.operationLease;
	for (let attempt = 0; attempt < 240; attempt += 1) {
		const current: any = value(await invoke(operation, { path: { teamId, leaseId: lease.id }, query: {}, body: undefined }));
		if (current?.publicKey && current.status === 'pending') return current;
		if (['cancelled', 'consumed', 'expired', 'failed'].includes(String(current?.status)))
			throw new Error(`Hosted credential lease ${lease.id} ended before authorization.`);
		await pause(500);
	}
	throw new Error(`Hosted credential lease ${lease.id} did not receive an ephemeral runner key.`);
}

async function authorizeLeases(leases: any[], teamId: string, invoke: Invoke, context: CommandContext) {
	if (!leases.length) return;
	if (context.outputFormat === 'human') for (const lease of leases) {
		const binding = lease.hostedBinding ?? {};
		context.write(`Authorize hosted credentials\nTeam: ${teamId}\nEnvironment: ${binding.environment ?? 'unknown'}\nSubject: ${binding.subjectDigest ?? 'unknown'}\nPurpose: ${lease.purpose}\nFields: ${(lease.requiredFields ?? []).join(', ')}\nExpires: ${lease.expiresAt}\n`, 'stderr');
	}
	const operations = CONTROL_PLANE_OPERATIONS.services;
	const userKey: any = value(await invoke(operations.userVaultKey, { path: {}, query: {}, body: undefined }));
	const vault: any = value(await invoke(operations.teamVault, { path: { teamId }, query: {}, body: undefined }));
	if (!userKey?.encryptedPrivateKeyEnvelope || !vault?.ownGrant)
		throw new Error('The current user needs an active personal key and team-vault grant before authorizing hosted credentials.');
	if (!context.interactiveUi && !context.promptSecret && !context.readStdin)
		throw new Error('Headless hosted client-vault authorization requires the passphrase on standard input.');
	const passphrase = context.promptSecret
		? String(await context.promptSecret('Personal service-vault passphrase: '))
		: context.readStdin ? String(await context.readStdin()).trim() : await promptHidden('Personal service-vault passphrase: ');
	const privateKey = await decryptServiceVaultPrivateKey(userKey.encryptedPrivateKeyEnvelope, passphrase);
	const teamKey = await openTeamVaultGrant({ version: SERVICE_VAULT_ENCRYPTION_VERSION, algorithm: 'x25519-sealed-box',
		recipientPublicKey: userKey.encryptedPrivateKeyEnvelope.publicKey,
		wrappedTeamVaultKey: vault.ownGrant.wrappedTeamVaultKey }, privateKey);
	const envelopeCache = new Map<string, any[]>();
	try {
		for (const lease of leases) {
			const current = await waitForLease(teamId, lease, invoke);
			let envelopes = envelopeCache.get(current.connectionId);
			if (!envelopes) {
				envelopes = value(await invoke(operations.credentialEnvelopes, {
					path: { teamId, connectionId: current.connectionId }, query: {}, body: undefined,
				})) as any[];
				envelopeCache.set(current.connectionId, envelopes);
			}
			const selected = envelopes.filter((item) => item.definitionId === current.credentialProfileId
				&& current.requiredFields.includes(item.fieldKey));
			if (selected.length !== current.requiredFields.length
				|| new Set(selected.map((item) => item.fieldKey)).size !== current.requiredFields.length)
				throw new Error(`Hosted credential profile ${current.credentialProfileId} is incomplete.`);
			let values: Record<string, string> = {};
			try {
				values = Object.fromEntries(await Promise.all(selected.map(async (item) => [item.fieldKey,
					await decryptServiceCredential(item.envelope, teamKey, canonicalServiceVaultAssociatedData({
						teamId, connectionId: current.connectionId, credentialProfileId: current.credentialProfileId,
						field: item.fieldKey, purpose: 'team-service-credential', version: item.keyVersion,
					})),
				])));
				const sealedPayload = await sealSecretOperationPayload(values, current.publicKey);
				await invoke(operations.putOperationLeasePayload, { path: { teamId, leaseId: current.id }, query: {},
					body: { sealedPayload } }, true);
			} finally { values = {}; }
		}
	} finally {
		clearServiceVaultKey(teamKey);
		clearServiceVaultKey(privateKey);
	}
}

async function waitForOperation(operationId: string, invoke: Invoke) {
	const operation = CONTROL_PLANE_OPERATIONS.operations.show;
	for (let attempt = 0; attempt < 600; attempt += 1) {
		const current: any = value(await invoke(operation, { path: { operationId }, query: {}, body: undefined }));
		if (current?.status === 'completed') return current.output;
		if (['cancelled', 'failed'].includes(String(current?.status)))
			throw Object.assign(new Error(current?.error?.message ?? `Hosted topology operation ${operationId} failed.`),
				{ category: 'operation_failed', code: current?.error?.code ?? 'hosted_topology_operation_failed' });
		await pause(500);
	}
	throw new Error(`Hosted topology operation ${operationId} did not complete within five minutes.`);
}

export async function completeHostedTopologyOperation(response: unknown, teamId: string, invoke: Invoke, context: CommandContext) {
	const accepted: any = value(response);
	if (!accepted?.operation?.id) return accepted;
	await authorizeLeases(Array.isArray(accepted.credentialLeases) ? accepted.credentialLeases : [], teamId, invoke, context);
	const output: any = await waitForOperation(accepted.operation.id, invoke);
	return output?.plan ?? output?.receipt ?? output;
}
