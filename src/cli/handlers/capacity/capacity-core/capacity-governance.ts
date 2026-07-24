import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityStringArg as argument } from './capacity-command-arguments.js';
import { capacityAuthenticatedMarketRequest as request } from './capacity-values.js';

export const CAPACITY_GOVERNANCE_ACTIONS = new Set([
	'registration-key',
	'registration-key-reveal',
	'registration-key-rotate',
	'registration-key-enable',
	'registration-key-disable',
	'provider-requests',
	'provider-request',
	'provider-approve',
	'provider-reject',
	'provider-cancel',
	'provider-memberships',
	'provider-membership',
	'audit-events',
	'audit-export',
	'provider-credentials',
	'provider-credential-revoke',
	'provider-team-credential-rotate',
	'provider-suspend',
	'provider-resume',
	'provider-revoke',
	'grants',
	'grant',
	'grant-validate',
	'grant-plan',
	'grant-apply',
	'grant-activate',
	'grant-pause',
	'grant-resume',
	'grant-revoke',
	'allocation-sets',
	'allocation',
	'allocation-validate',
	'allocation-plan',
	'allocation-create',
	'allocation-activate',
	'allocation-supersede',
	'allocation-archive',
	'allocation-explain',
]);

export const MUTATING_CAPACITY_GOVERNANCE_ACTIONS = new Set([
	'registration-key-rotate',
	'registration-key-enable',
	'registration-key-disable',
	'provider-approve',
	'provider-reject',
	'provider-cancel',
	'provider-credential-revoke',
	'provider-team-credential-rotate',
	'provider-suspend',
	'provider-resume',
	'provider-revoke',
	'grant-apply',
	'grant-activate',
	'grant-pause',
	'grant-resume',
	'grant-revoke',
	'allocation-create',
	'allocation-activate',
	'allocation-supersede',
	'allocation-archive',
]);

async function confirmSecretOperation(
	action: string,
	invocation: ParsedInvocation,
	context: CommandContext,
) {
	if (invocation.args.yes === true) return true;
	if (!context.confirm) return false;
	return context.confirm(
		action === 'registration-key-reveal'
			? 'Reveal the team capacity registration key? This exposes a broadcast secret.'
			: 'Rotate the team capacity registration key? This invalidates the previous key and cancels its pending registrations.',
		'yes',
	);
}

function mutationHeaders(invocation: ParsedInvocation) {
	return { 'idempotency-key': argument(invocation, 'idempotencyKey') ?? randomUUID() };
}

function pathSegment(value: string) {
	return encodeURIComponent(value);
}

function collectionQuery(invocation: ParsedInvocation, filters: Record<string, string | null> = {}) {
	const query = new URLSearchParams();
	for (const [name, value] of Object.entries(filters)) {
		if (value) query.set(name, value);
	}
	const limit = argument(invocation, 'limit');
	const cursor = argument(invocation, 'cursor');
	if (limit) query.set('limit', limit);
	if (cursor) query.set('cursor', cursor);
	return query.size ? `?${query}` : '';
}

function numberArgument(invocation: ParsedInvocation, name: string) {
	const value = invocation.args[name];
	if (value === undefined || value === null || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function listArgument(invocation: ParsedInvocation, name: string) {
	const value = argument(invocation, name);
	return value ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))] : [];
}

async function documentArgument(invocation: ParsedInvocation, context: CommandContext) {
	const inline = argument(invocation, 'document');
	const file = argument(invocation, 'file');
	if (!inline && !file) return null;
	const source = inline ?? await readFile(resolve(context.cwd, file!), 'utf8');
	const parsed = parseYaml(source);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Capacity policy document must be a JSON or YAML object.');
	return parsed as Record<string, unknown>;
}

function grantCreateBody(invocation: ParsedInvocation) {
	return {
		membershipId: argument(invocation, 'membership'),
		projectId: argument(invocation, 'project'),
		environment: argument(invocation, 'environment') ?? 'local',
		executionProviderIds: listArgument(invocation, 'executionProviders'),
		capabilities: listArgument(invocation, 'capabilities'),
		allowedModes: listArgument(invocation, 'modes'),
		dailyCreditLimit: numberArgument(invocation, 'dailyCredits'),
		monthlyCreditLimit: numberArgument(invocation, 'monthlyCredits'),
		maxConcurrentAssignments: numberArgument(invocation, 'maxConcurrentAssignments'),
		unmetered: invocation.args.unmetered === true,
		expiresAt: argument(invocation, 'expiresAt'),
	};
}

export async function runCapacityGovernanceAction(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const teamId = argument(invocation, 'team');
	if (!teamId) return fail(`Missing --team. Use \`trsd capacity ${action} --team <team-id> --json\`.`);
	const mutation = MUTATING_CAPACITY_GOVERNANCE_ACTIONS.has(action);
	const plan = invocation.args.plan === true;
	const execute = invocation.args.execute === true;
	if (mutation && plan === execute) {
		return fail(`Capacity ${action} is mutating. Choose exactly one of --plan or --execute.`);
	}
	const requestId = argument(invocation, 'request');
	const membershipId = argument(invocation, 'membership');
	const grantId = argument(invocation, 'grant');
	const credentialId = argument(invocation, 'credential');
	const allocationId = argument(invocation, 'allocation');
	if (action === 'audit-export' && !argument(invocation, 'file')) {
		return fail('Capacity audit-export requires --file <path>.');
	}
	if (action === 'registration-key-reveal' || (action === 'registration-key-rotate' && execute)) {
		if (!await confirmSecretOperation(action, invocation, context)) {
			return fail(`Capacity ${action} requires explicit confirmation. Re-run with --yes for noninteractive automation.`);
		}
	}
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
	const perform = <T>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
		if (mutation && plan && options.method && options.method !== 'GET') {
			return Promise.resolve({
				mode: 'plan',
				method: options.method,
				path,
				body: options.body ?? null,
				idempotencyKey: options.headers?.['idempotency-key'] ?? null,
			} as T);
		}
		return request<T>(client, path, options);
	};
	const team = pathSegment(teamId);
	let payload: unknown;
	if (action === 'registration-key') payload = await perform(`/v1/teams/${team}/capacity-registration-key`);
	else if (action === 'registration-key-reveal') payload = await perform(`/v1/teams/${team}/capacity-registration-key/reveal`);
	else if (action.startsWith('registration-key-')) {
		const operation = action.slice('registration-key-'.length);
		payload = await perform(`/v1/teams/${team}/capacity-registration-key/${operation}`, { method: 'POST', headers: mutationHeaders(invocation) });
	} else if (action === 'provider-requests') {
		payload = await perform(`/v1/teams/${team}/capacity-provider-requests${collectionQuery(invocation, { status: argument(invocation, 'status') })}`);
	} else if (action === 'provider-request') {
		if (!requestId) return fail('Missing --request for provider-request.');
		payload = await perform(`/v1/teams/${team}/capacity-provider-requests/${pathSegment(requestId)}`);
	} else if (['provider-approve', 'provider-reject', 'provider-cancel'].includes(action)) {
		if (!requestId) return fail(`Missing --request for ${action}.`);
		const operation = action.slice('provider-'.length);
		const body = operation === 'approve'
			? { teamAlias: argument(invocation, 'teamAlias') }
			: operation === 'reject'
				? { reason: argument(invocation, 'reason') }
				: {};
		payload = await perform(`/v1/teams/${team}/capacity-provider-requests/${pathSegment(requestId)}/${operation}`, { method: 'POST', headers: mutationHeaders(invocation), body });
	} else if (action === 'provider-memberships') {
		payload = await perform(`/v1/teams/${team}/capacity-provider-memberships${collectionQuery(invocation, {
			status: argument(invocation, 'status'),
			providerId: argument(invocation, 'provider'),
		})}`);
	} else if (action === 'provider-membership') {
		if (!membershipId) return fail('Missing --membership for provider-membership.');
		payload = await perform(`/v1/teams/${team}/capacity-provider-memberships/${pathSegment(membershipId)}`);
	}
	else if (action === 'audit-events' || action === 'audit-export') {
		payload = await perform(`/v1/teams/${team}/capacity-audit-events${collectionQuery(invocation, {
			providerId: argument(invocation, 'provider'),
			membershipId,
			action: argument(invocation, 'auditAction'),
			resourceType: argument(invocation, 'resourceType'),
			resourceId: argument(invocation, 'resourceId'),
		})}`);
	}
	else if (action === 'provider-credentials') {
		if (!membershipId) return fail('Missing --membership for provider-credentials.');
		payload = await perform(`/v1/teams/${team}/capacity-provider-memberships/${pathSegment(membershipId)}/credentials${collectionQuery(invocation, { status: argument(invocation, 'status') })}`);
	} else if (action === 'provider-credential-revoke') {
		if (!membershipId || !credentialId) return fail('provider-credential-revoke requires --membership and --credential.');
		payload = await perform(`/v1/teams/${team}/capacity-provider-memberships/${pathSegment(membershipId)}/credentials/${pathSegment(credentialId)}/revoke`, { method: 'POST', headers: mutationHeaders(invocation) });
	} else if (action === 'provider-team-credential-rotate') {
		if (!membershipId) return fail('provider-team-credential-rotate requires --membership.');
		payload = await perform(`/v1/teams/${team}/capacity-provider-memberships/${pathSegment(membershipId)}/credentials/rotate`, { method: 'POST', headers: mutationHeaders(invocation) });
	}
	else if (action === 'grants') {
		const filters = new URLSearchParams();
		if (membershipId) filters.set('membershipId', membershipId);
		if (argument(invocation, 'project')) filters.set('projectId', argument(invocation, 'project')!);
		if (argument(invocation, 'status')) filters.set('status', argument(invocation, 'status')!);
		if (argument(invocation, 'limit')) filters.set('limit', argument(invocation, 'limit')!);
		if (argument(invocation, 'cursor')) filters.set('cursor', argument(invocation, 'cursor')!);
		payload = await perform(`/v1/teams/${team}/capacity-grants${filters.size ? `?${filters}` : ''}`);
	} else if (action === 'grant') {
		if (!grantId) return fail('Missing --grant for grant.');
		payload = await perform(`/v1/teams/${team}/capacity-grants/${pathSegment(grantId)}`);
	} else if (action === 'grant-apply' || action === 'grant-plan' || action === 'grant-validate') {
		const body = (await documentArgument(invocation, context)) ?? grantCreateBody(invocation);
		if (!body.membershipId || !body.projectId) return fail(`${action} requires --membership and --project, or a complete --file/--document policy.`);
		const planning = action !== 'grant-apply';
		payload = await perform(`/v1/teams/${team}/capacity-grants${planning ? '/plan' : ''}`, {
			method: 'POST',
			headers: planning ? undefined : mutationHeaders(invocation),
			body,
		});
	} else if (action.startsWith('grant-')) {
		if (!grantId) return fail(`Missing --grant for ${action}.`);
		payload = await perform(`/v1/teams/${team}/capacity-grants/${pathSegment(grantId)}/${action.slice('grant-'.length)}`, { method: 'POST', headers: mutationHeaders(invocation) });
	} else if (action === 'allocation-sets') {
		const page = new URLSearchParams();
		if (argument(invocation, 'limit')) page.set('limit', argument(invocation, 'limit')!);
		if (argument(invocation, 'cursor')) page.set('cursor', argument(invocation, 'cursor')!);
		payload = await perform(`/v1/teams/${team}/capacity/allocation-sets${page.size ? `?${page}` : ''}`);
	}
	else if (action === 'allocation') {
		if (!allocationId) return fail('Missing --allocation for allocation.');
		payload = await perform(`/v1/teams/${team}/capacity/allocation-sets/${pathSegment(allocationId)}`);
	} else if (action === 'allocation-plan' || action === 'allocation-validate' || action === 'allocation-create') {
		const body = await documentArgument(invocation, context);
		if (!body) return fail(`${action} requires --file <policy.yaml> or --document '<json-or-yaml>'.`);
		const planning = action !== 'allocation-create';
		payload = await perform(`/v1/teams/${team}/capacity/allocation-sets${planning ? '/plan' : ''}`, {
			method: 'POST',
			headers: planning ? undefined : mutationHeaders(invocation),
			body,
		});
	} else if (action === 'allocation-explain') {
		if (!allocationId) return fail('Missing --allocation for allocation-explain.');
		const body = await documentArgument(invocation, context);
		if (!body) return fail('allocation-explain requires --file <request.yaml> or --document \'<json-or-yaml>\'.');
		payload = await perform(`/v1/teams/${team}/capacity/allocation-sets/${pathSegment(allocationId)}/explain`, { method: 'POST', body });
	} else if (action === 'allocation-supersede') {
		if (!allocationId) return fail('Missing --allocation for allocation-supersede.');
		const body = (await documentArgument(invocation, context)) ?? {};
		payload = await perform(`/v1/teams/${team}/capacity/allocation-sets/${pathSegment(allocationId)}/supersede`, {
			method: 'POST',
			headers: mutationHeaders(invocation),
			body,
		});
	} else if (action.startsWith('allocation-')) {
		if (!allocationId) return fail(`Missing --allocation for ${action}.`);
		payload = await perform(`/v1/teams/${team}/capacity/allocation-sets/${pathSegment(allocationId)}/${action.slice('allocation-'.length)}`, { method: 'POST', headers: mutationHeaders(invocation) });
	}
	else {
		if (!membershipId) return fail(`Missing --membership for ${action}.`);
		const operation = action.slice('provider-'.length);
		payload = await perform(`/v1/teams/${team}/capacity-provider-memberships/${pathSegment(membershipId)}/${operation}`, { method: 'POST', headers: mutationHeaders(invocation) });
	}
	const outputPath = action === 'audit-export' ? resolve(context.cwd, argument(invocation, 'file')!) : null;
	if (outputPath) {
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
	}
	return guidedResult({
		command: `capacity ${action}`,
		summary: outputPath
			? `Exported capacity audit evidence for team ${teamId}.`
			: mutation && plan
				? `Capacity governance operation ${action} plan rendered without mutation.`
				: `Capacity governance operation ${action} completed for team ${teamId}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: teamId }, { label: 'Operation', value: action }, { label: 'Output', value: outputPath }],
		report: { mode: mutation ? (plan ? 'plan' : 'live') : 'read', action, teamId, outputPath, payload },
	});
}
