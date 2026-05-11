import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createMarketClientForInvocation } from './market-utils.js';

function required(value: unknown, message: string) {
	if (typeof value === 'string' && value.trim()) return value.trim();
	throw new Error(message);
}

export const handleCapacity: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const teamId = typeof invocation.args.team === 'string' ? invocation.args.team : typeof profile.teamId === 'string' ? profile.teamId : null;

	if (action === 'status') {
		const team = required(teamId, 'Usage: treeseed capacity status --team <team-id>');
		const response = await client.teamCapacity(team);
		const summary = response.payload.summary as Record<string, unknown> | undefined;
		return guidedResult({
			command: 'capacity',
			summary: 'Team helper capacity status',
			facts: [
				{ label: 'Market', value: profile.id },
				{ label: 'Team', value: team },
				{ label: 'Monthly remaining', value: summary?.monthlyRemainingCredits as number | null | undefined },
				{ label: 'Daily remaining', value: summary?.dailyRemainingCredits as number | null | undefined },
				{ label: 'Active providers', value: summary?.activeProviderCount as number | null | undefined },
			],
			report: { marketId: profile.id, teamId: team, capacity: response.payload },
		});
	}

	if (action === 'providers') {
		const subcommand = invocation.positionals[1] ?? 'list';
		const team = required(teamId, 'Usage: treeseed capacity providers list --team <team-id>');
		if (subcommand === 'list') {
			const response = await client.teamCapacity(team);
			const providers = (response.payload.providers as any[]) ?? [];
			return guidedResult({
				command: 'capacity',
				summary: `Found ${providers.length} helper capacity provider${providers.length === 1 ? '' : 's'}.`,
				sections: [{
					title: 'Providers',
					lines: providers.map((provider) => `${provider.id}  ${provider.name}  ${provider.status}  workers=${provider.maxConcurrentWorkers ?? 0}`),
				}],
				report: { marketId: profile.id, teamId: team, providers },
			});
		}
		if (subcommand === 'connect') {
			const response = await client.launchManagedCapacityProvider(team, { launchSource: 'cli' });
			return guidedResult({
				command: 'capacity',
				summary: 'TreeSeed-managed helper capacity is connected.',
				facts: [
					{ label: 'Provider', value: (response.payload.provider as any)?.id },
					{ label: 'Security code prefix', value: (response.payload.apiKey as any)?.keyPrefix },
				],
				report: { marketId: profile.id, teamId: team, result: response.payload },
			});
		}
		if (subcommand === 'keys') {
			const keyAction = invocation.positionals[2] ?? 'reset';
			const providerId = required(invocation.args.provider, 'Usage: treeseed capacity providers keys reset --provider <provider-id>');
			if (keyAction === 'reset') {
				const response = await client.resetCapacityProviderApiKey(providerId, { name: 'Provider security code' });
				return guidedResult({
					command: 'capacity',
					summary: 'Provider security code was reset.',
					facts: [
						{ label: 'Provider', value: providerId },
						{ label: 'Prefix', value: (response.payload.key as any)?.keyPrefix },
						{ label: 'Security access code', value: response.payload.plaintextKey as string | undefined },
					],
					report: { marketId: profile.id, providerId, result: response.payload },
				});
			}
			if (keyAction === 'revoke') {
				const keyId = required(invocation.args.key, 'Usage: treeseed capacity providers keys revoke --provider <provider-id> --key <key-id>');
				const response = await client.revokeCapacityProviderApiKey(providerId, keyId);
				return guidedResult({
					command: 'capacity',
					summary: 'Provider security code was revoked.',
					facts: [
						{ label: 'Provider', value: providerId },
						{ label: 'Key', value: keyId },
					],
					report: { marketId: profile.id, providerId, keyId, result: response.payload },
				});
			}
		}
		return { exitCode: 1, stderr: [`Unknown capacity providers action: ${subcommand}`] };
	}

	if (action === 'grants') {
		const subcommand = invocation.positionals[1] ?? 'list';
		const team = required(teamId, 'Usage: treeseed capacity grants list --team <team-id>');
		if (subcommand === 'list') {
			const response = await client.capacityGrants(team);
			return guidedResult({
				command: 'capacity',
				summary: `Found ${response.payload.length} capacity grant${response.payload.length === 1 ? '' : 's'}.`,
				sections: [{
					title: 'Grants',
					lines: response.payload.map((grant: any) => `${grant.id}  ${grant.grantScope}  daily=${grant.dailyCreditLimit ?? 'policy'}  monthly=${grant.monthlyCreditLimit ?? 'policy'}`),
				}],
				report: { marketId: profile.id, teamId: team, grants: response.payload },
			});
		}
		if (subcommand === 'create') {
			const providerId = required(invocation.args.provider, 'Usage: treeseed capacity grants create --team <team-id> --provider <provider-id>');
			const response = await client.createCapacityGrant(team, {
				capacityProviderId: providerId,
				projectId: typeof invocation.args.project === 'string' ? invocation.args.project : null,
				environment: typeof invocation.args.environment === 'string' ? invocation.args.environment : null,
				dailyCreditLimit: Number(invocation.args.daily ?? 25),
				monthlyCreditLimit: Number(invocation.args.monthly ?? 500),
				overflowPolicy: typeof invocation.args.overflow === 'string' ? invocation.args.overflow : 'approval_required',
			});
			return guidedResult({
				command: 'capacity',
				summary: 'Capacity grant created.',
				facts: [
					{ label: 'Grant', value: (response.payload as any).id },
					{ label: 'Provider', value: providerId },
				],
				report: { marketId: profile.id, teamId: team, grant: response.payload },
			});
		}
		return { exitCode: 1, stderr: [`Unknown capacity grants action: ${subcommand}`] };
	}

	if (action === 'enqueue') {
		const projectId = required(invocation.args.project, 'Usage: treeseed capacity enqueue --project <project-id> --task-kind <kind>');
		const response = await client.enqueueAgentTask(projectId, {
			taskKind: typeof invocation.args.taskKind === 'string' ? invocation.args.taskKind : typeof invocation.args.task === 'string' ? invocation.args.task : 'proposal.draft',
			environment: typeof invocation.args.environment === 'string' ? invocation.args.environment : 'staging',
		});
		return guidedResult({
			command: 'capacity',
			summary: 'Budgeted agent task enqueued.',
			facts: [
				{ label: 'Task', value: (response.payload.task as any)?.id },
				{ label: 'Reserved credits', value: (response.payload.reservation as any)?.reservedCredits },
			],
			report: { marketId: profile.id, projectId, result: response.payload },
		});
	}

	return { exitCode: 1, stderr: [`Unknown capacity action: ${action}`] };
};
