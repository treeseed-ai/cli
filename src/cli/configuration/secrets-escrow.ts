import {
	assertGitHubActionsEncryptedSecretDeployment,
	buildClientEncryptedEscrowEnvelope,
	summarizeClientEncryptedEscrowStatus,
	type ClientEncryptedEscrowEnvelopeInput,
	type GitHubActionsEncryptedSecretDeployment,
} from '@treeseed/sdk/secrets-capability';

type SecretCapabilityStateInput = Partial<ClientEncryptedEscrowEnvelopeInput> & {
	custodyMode?: string | null;
	githubSecretTarget?: {
		repository?: string | null;
		environment?: string | null;
		secretName?: string | null;
		scope?: string | null;
	} | null;
	providerOwned?: boolean | null;
	bootstrap?: boolean | null;
	hostInjected?: boolean | null;
	metadataOnly?: boolean | null;
	failClosedCode?: string | null;
	driftCode?: string | null;
};

export function buildCliClientEncryptedEscrowBody(
	input: ClientEncryptedEscrowEnvelopeInput & {
		name?: string;
		secretClass?: string;
		secretMetadata?: Record<string, unknown>;
	},
) {
	const envelope = buildClientEncryptedEscrowEnvelope(input);
	return {
		...envelope,
		name: input.name,
		secretClass: input.secretClass,
		secretMetadata: input.secretMetadata,
		recoveryPolicy: 'reentry_required',
	};
}

export function summarizeCliClientEncryptedEscrow(record: ClientEncryptedEscrowEnvelopeInput, now = new Date()) {
	const summary = summarizeClientEncryptedEscrowStatus(record, now);
	return {
		...summary,
		label: summary.reentryRequired
			? 're-entry required'
			: summary.migrated
				? 'migrated'
				: summary.tombstoned
					? 'tombstoned'
					: 'escrowed',
	};
}

export function buildCliGitHubActionsSecretDeploymentBody(input: GitHubActionsEncryptedSecretDeployment & Record<string, unknown>) {
	return {
		...assertGitHubActionsEncryptedSecretDeployment(input),
		custodyMode: 'github_actions_secret_enclave',
	};
}

export function summarizeCliSecretCapabilityState(input: SecretCapabilityStateInput, now = new Date()) {
	const custodyMode = input.custodyMode ?? (
		input.bootstrap ? 'bootstrap_service_secret'
			: input.providerOwned ? 'provider_owned_secret'
				: input.hostInjected ? 'host_env_injection'
					: input.metadataOnly ? 'metadata_only_reentry'
						: input.githubSecretTarget ? 'github_actions_secret_enclave'
							: input.ciphertextRef || input.ciphertext ? 'client_encrypted_escrow'
								: 'metadata_only_reentry'
	);
	const escrow = custodyMode === 'client_encrypted_escrow'
		? summarizeCliClientEncryptedEscrow(input as ClientEncryptedEscrowEnvelopeInput, now)
		: null;
	const label = escrow?.label
		?? (custodyMode === 'github_actions_secret_enclave' ? 'GitHub-backed'
			: custodyMode === 'host_env_injection' ? 'host-injected'
				: custodyMode === 'bootstrap_service_secret' ? 'bootstrap'
					: custodyMode === 'provider_owned_secret' ? 'provider-owned'
						: 'metadata-only');
	const warnings = [
		...(custodyMode === 'bootstrap_service_secret' ? ['Bootstrap service secrets are crown-jewel operational secrets and should stay outside customer project custody.'] : []),
		...(custodyMode === 'host_env_injection' ? ['Host env injection exposes runtime secrets to the selected host and must remain explicit.'] : []),
		...(input.failClosedCode || input.driftCode ? [`Secret capability is fail-closed: ${input.failClosedCode ?? input.driftCode}.`] : []),
		...(escrow?.reentryRequired ? ['Re-enter this secret before it can be migrated or deployed.'] : []),
	];
	return {
		custodyMode,
		label,
		escrowed: escrow?.escrowed ?? false,
		githubBacked: custodyMode === 'github_actions_secret_enclave',
		hostInjected: custodyMode === 'host_env_injection',
		metadataOnly: custodyMode === 'metadata_only_reentry',
		bootstrap: custodyMode === 'bootstrap_service_secret',
		providerOwned: custodyMode === 'provider_owned_secret',
		migrated: escrow?.migrated ?? false,
		expired: escrow?.expired ?? false,
		tombstoned: escrow?.tombstoned ?? false,
		reentryRequired: escrow?.reentryRequired ?? false,
		target: input.githubSecretTarget ?? input.deploymentIntent ?? null,
		warnings,
	};
}
