import type { CommandHandler } from '../../types.js';
import { readFile } from 'node:fs/promises';
import { containsForbiddenPlaintextSecretMaterial, validateEncryptedCredentialEnvelope } from '@treeseed/sdk/secrets-capability';
import { createMarketClientForInvocation } from '../content/market-utils.js';
import { guidedResult } from '../utilities/utils.js';

function option(invocation: Parameters<CommandHandler>[0], key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireValue(value: string | null, usage: string) {
	if (!value) throw new Error(usage);
	return value;
}

export const handleServices: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: action !== 'providers' });
	const teamId = option(invocation, 'team') ?? profile.teamId ?? null;
	const connectionId = option(invocation, 'connection') ?? invocation.positionals[1] ?? null;
	const projectId = option(invocation, 'project');
	const runId = option(invocation, 'run');

	try {
		if (action === 'providers') {
			const response = await client.request<any>('/v1/service-providers');
			return guidedResult({
				command: 'services providers',
				summary: 'Supported service providers and capability types',
				sections: response.payload.map((provider: any) => ({
					title: provider.label,
					lines: provider.capabilities.map((capability: any) => `${capability.type}  ${capability.status}`),
				})),
				report: { marketId: profile.id, providers: response.payload },
			});
		}

		const selectedTeam = requireValue(teamId, 'Use --team <team-id> or select a team in the Market profile.');
		if (action === 'repository') {
			const selectedProject = requireValue(projectId, 'Use --project <project-id>.');
			const response = await client.request<any>(`/v1/projects/${encodeURIComponent(selectedProject)}/repository-topology`);
			const remote = response.payload.remoteBinding;
			return guidedResult({ command: 'services repository', summary: 'Remote repository and TreeDX topology',
				facts: [{ label: 'Provider', value: remote?.providerId ?? 'Not bound' },
					{ label: 'Repository', value: remote ? `${remote.owner}/${remote.name}` : 'Not bound' },
					{ label: 'Publication ref', value: remote?.publicationRef ?? 'Not bound' },
					{ label: 'Grant', value: remote?.grantStatus ?? 'Missing' },
					{ label: 'Expected / observed', value: `${remote?.expectedHead ?? '—'} / ${remote?.observedHead ?? '—'}` },
					{ label: 'Drift', value: remote?.drift ?? 'Unknown' }],
				report: { marketId: profile.id, projectId: selectedProject, topology: response.payload } });
		}
		if (action === 'workflows') {
			const selectedProject = requireValue(projectId, 'Use --project <project-id>.');
			const response = await client.request<any>(`/v1/projects/${encodeURIComponent(selectedProject)}/workflow-operations`);
			return guidedResult({ command: 'services workflows', summary: 'Allowlisted remote workflow operations',
				sections: [{ title: 'Operations', lines: response.payload.map((item: any) =>
					`${item.id}  ${item.workflowId}  refs=${item.refPolicy.join(',')}  modes=${item.modePolicy.join(',')}`) }],
				report: { marketId: profile.id, projectId: selectedProject, workflows: response.payload } });
		}
		if (action === 'workflow-run') {
			const selectedRun = requireValue(runId, 'Use --run <workflow-run-id>.');
			const response = await client.request<any>(`/v1/workflow-operation-runs/${encodeURIComponent(selectedRun)}`);
			return guidedResult({ command: 'services workflow-run', summary: 'Authoritative workflow run status',
				facts: [{ label: 'Status', value: response.payload.status }, { label: 'Provider run', value: response.payload.providerRunId ?? 'Pending' },
					{ label: 'Source', value: response.payload.sourceSha }, { label: 'Ref', value: response.payload.ref },
					{ label: 'Correlation', value: response.payload.correlationId }],
				report: { marketId: profile.id, run: response.payload } });
		}
		if (action === 'list') {
			const response = await client.request<any>(`/v1/teams/${encodeURIComponent(selectedTeam)}/services`);
			return guidedResult({
				command: 'services list',
				summary: 'Team provider services',
				sections: [{
					title: 'Connections',
					lines: response.payload.map((connection: any) =>
						`${connection.id}  ${connection.providerId}  ${connection.displayName}  ${connection.status}  ${connection.capabilities.map((item: any) => item.capabilityType).join(', ')}`,
					),
				}],
				report: { marketId: profile.id, teamId: selectedTeam, connections: response.payload },
			});
		}

		const selectedConnection = requireValue(connectionId, 'Use --connection <connection-id>.');
		if (action === 'show') {
			const response = await client.request<any>(
				`/v1/teams/${encodeURIComponent(selectedTeam)}/services/${encodeURIComponent(selectedConnection)}`,
			);
			return guidedResult({
				command: 'services show',
				summary: `${response.payload.displayName} service metadata`,
				facts: [
					{ label: 'Provider', value: response.payload.providerId },
					{ label: 'Status', value: response.payload.status },
					{ label: 'Capabilities', value: response.payload.capabilities.map((item: any) => item.capabilityType).join(', ') || 'None' },
					{ label: 'Credential custody', value: response.payload.credentialProfiles.length ? response.payload.credentialProfiles.map((item: any) => item.custodyMode).join(', ') : 'Not configured' },
				],
				report: { marketId: profile.id, teamId: selectedTeam, connection: response.payload },
			});
		}
		if (action === 'authorities') {
			const response = await client.request<any>(
				`/v1/teams/${encodeURIComponent(selectedTeam)}/services/${encodeURIComponent(selectedConnection)}/credential-authorities`,
			);
			return guidedResult({ command: 'services authorities', summary: 'Provider credential authority readiness',
				sections: [{ title: 'Authorities', lines: response.payload.map((item: any) =>
					`${item.credentialProfileId}  ${item.scheme}  ${item.status}  capabilities=${item.capabilities.join(',')}`) }],
				report: { marketId: profile.id, teamId: selectedTeam, connectionId: selectedConnection, authorities: response.payload } });
		}

		if (action === 'envelopes') {
			const response = await client.request<any>(
				`/v1/teams/${encodeURIComponent(selectedTeam)}/services/${encodeURIComponent(selectedConnection)}/credential-envelopes`,
			);
			return guidedResult({
				command: 'services envelopes',
				summary: 'Encrypted credential-envelope export',
				sections: [{
					title: 'Encrypted fields',
					lines: response.payload.map((item: any) => `${item.fieldKey}  key-version=${item.keyVersion}  fingerprint=${item.fingerprint}`),
				}],
				report: {
					marketId: profile.id,
					teamId: selectedTeam,
					connectionId: selectedConnection,
					envelopes: response.payload,
					warning: 'Ciphertext is portable only with its associated vault grants and contextual binding.',
				},
			});
		}

		if (action === 'import-envelopes') {
			const file = requireValue(option(invocation, 'file'), 'Use --file <encrypted-envelope-json>.');
			const parsed = JSON.parse(await readFile(file, 'utf8'));
			const imported = Array.isArray(parsed) ? parsed : parsed.envelopes;
			if (!Array.isArray(imported) || !imported.length) throw new Error('The file does not contain encrypted envelopes.');
			if (containsForbiddenPlaintextSecretMaterial(parsed).length) throw new Error('The import contains plaintext secret-shaped fields and was rejected.');
			for (const item of imported) {
				if (!validateEncryptedCredentialEnvelope(item.envelope) || !item.definitionId || !item.fieldKey || !item.keyVersion) {
					throw new Error('Every imported item must contain a valid contextual envelope, definitionId, fieldKey, and keyVersion.');
				}
				await client.request(
					`/v1/teams/${encodeURIComponent(selectedTeam)}/services/${encodeURIComponent(selectedConnection)}/credential-envelopes`,
					{ method: 'POST', body: item },
				);
			}
			return guidedResult({
				command: 'services import-envelopes',
				summary: 'Encrypted credential envelopes imported',
				facts: [{ label: 'Imported', value: imported.length }],
				report: { marketId: profile.id, teamId: selectedTeam, connectionId: selectedConnection, imported: imported.length },
			});
		}

		if (action === 'lease') {
			const leaseId = requireValue(option(invocation, 'lease'), 'Use --lease <lease-id>.');
			const response = await client.request<any>(
				`/v1/teams/${encodeURIComponent(selectedTeam)}/service-operation-leases/${encodeURIComponent(leaseId)}`,
			);
			return guidedResult({
				command: 'services lease',
				summary: 'Secret operation lease metadata',
				facts: [
					{ label: 'Status', value: response.payload.status },
					{ label: 'Connection', value: response.payload.connectionId },
					{ label: 'Capability', value: response.payload.capabilityType },
					{ label: 'Expires', value: response.payload.expiresAt },
				],
				report: { marketId: profile.id, teamId: selectedTeam, lease: response.payload },
			});
		}

		return { exitCode: 1, stderr: [`Unknown services action: ${action}`] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { exitCode: 1, stderr: [message], report: { ok: false, error: message } };
	}
};
