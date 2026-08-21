import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	createCommandResult,
	validateRepositoryWorkdayProfileBundle,
	type CommandErrorCategory,
} from '@treeseed/sdk/operator-contracts';
import type { CommandContext, CommandHandler, CommandResult, ParsedInvocation } from '../../types.js';
import { createMarketClientForInvocation } from '../content/market-utils.js';
import { capacityMarketRequest, capacityQuery } from '../capacity/capacity-core/capacity-values.js';
import { resolveCapacityTeam } from '../capacity/capacity-core/capacity-market-context.js';

type ApiPayload = { ok?: boolean; payload?: unknown; error?: string; code?: string };

const MUTATIONS = new Set([
	'providers connect', 'providers disconnect', 'providers requests approve', 'providers requests reject',
	'providers credentials rotate', 'providers credentials revoke', 'providers offers apply',
	'workdays start', 'workdays pause', 'workdays resume', 'workdays stop', 'workdays cancel',
	'workdays schedules start', 'workdays schedules pause', 'workdays schedules resume', 'workdays schedules retire',
	'assignments retry', 'assignments cancel',
]);

const CONFIRMATIONS = new Set([
	'providers connect', 'providers disconnect', 'providers requests approve', 'providers requests reject',
	'providers credentials rotate', 'providers credentials revoke', 'providers offers apply',
	'workdays start', 'workdays pause', 'workdays resume', 'workdays stop', 'workdays cancel',
	'workdays schedules start', 'workdays schedules pause', 'workdays schedules resume', 'workdays schedules retire',
	'assignments retry', 'assignments cancel',
]);

function option(invocation: ParsedInvocation, name: string) {
	const value = invocation.args[name];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positional(invocation: ParsedInvocation, index = 0) {
	return invocation.positionals[index]?.trim() || null;
}

function result(commandPath: string, mode: 'execute' | 'plan', payload: unknown, nextActions: string[] = []): CommandResult {
	const envelope = createCommandResult({ commandPath: commandPath.split(' '), mode, ok: true, result: payload, error: null, warnings: [], blockers: [], receipts: [], nextActions });
	return { exitCode: 0, stdout: [mode === 'plan' ? 'No mutation was performed.' : 'The control-plane operation completed.', JSON.stringify(payload, null, 2)], report: envelope as unknown as Record<string, unknown> };
}

function failure(commandPath: string, category: CommandErrorCategory, code: string, message: string, mode: 'execute' | 'plan' = 'execute'): CommandResult {
	const envelope = createCommandResult({ commandPath: commandPath.split(' '), mode, ok: false, result: null, error: { category, code, message }, warnings: [], blockers: [{ code, message }], receipts: [], nextActions: [] });
	return { exitCode: 1, stderr: [message], report: envelope as unknown as Record<string, unknown> };
}

async function confirmed(invocation: ParsedInvocation, context: CommandContext) {
	if (!CONFIRMATIONS.has(invocation.commandName) || invocation.args.plan === true || invocation.args.yes === true) return true;
	return context.confirm ? context.confirm(`Execute governed operation \`${invocation.commandName}\`?`, 'no') : false;
}

function queryOptions(invocation: ParsedInvocation, extra: Record<string, string | null> = {}) {
	return capacityQuery({ status: option(invocation, 'status'), limit: option(invocation, 'limit'), cursor: option(invocation, 'cursor'), ...extra });
}

async function localProfileValidation(invocation: ParsedInvocation, context: CommandContext) {
	const file = positional(invocation) ?? option(invocation, 'file');
	if (!file) throw new Error('A repository profile file is required.');
	const parsed = parseYaml(await readFile(resolve(context.cwd, file), 'utf8')) as unknown;
	const bundle = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'profiles' in parsed
		? parsed as Parameters<typeof validateRepositoryWorkdayProfileBundle>[0]
		: { schemaVersion: 'treeseed.workday-allocation-profile-bundle/v1' as const, profiles: [parsed] } as Parameters<typeof validateRepositoryWorkdayProfileBundle>[0];
	const diagnostics = validateRepositoryWorkdayProfileBundle(bundle);
	return { valid: diagnostics.length === 0, diagnostics, profileCount: bundle.profiles.length };
}

function providerLegacyInvocation(invocation: ParsedInvocation, action: string): ParsedInvocation {
	const first = positional(invocation);
	return {
		...invocation,
		commandName: 'capacity',
		positionals: [action],
		args: {
			...invocation.args,
			connection: option(invocation, 'connection') ?? first ?? undefined,
			file: option(invocation, 'file') ?? (invocation.commandName.startsWith('providers offers ') ? first ?? undefined : undefined),
			execute: invocation.args.plan === true ? undefined : true,
		},
	};
}

async function providerLocalOperation(invocation: ParsedInvocation, context: CommandContext) {
	const actions: Record<string, string> = {
		'providers list': 'provider-connections', 'providers show': 'provider-connection', 'providers status': 'provider-connection',
		'providers diagnose': 'provider-connection', 'providers connect': 'provider-join', 'providers disconnect': 'provider-leave',
		'providers offers show': 'provider-connection', 'providers offers validate': 'provider-offer-validate',
		'providers offers plan': 'provider-offer-plan', 'providers offers apply': 'provider-offer-apply',
	};
	const action = actions[invocation.commandName];
	if (!action) return null;
	const { runCapacityProviderGovernanceAction } = await import('../capacity/providers/capacity-provider-governance.js');
	return runCapacityProviderGovernanceAction(action, providerLegacyInvocation(invocation, action), context);
}

export const handleOperatorCommand: CommandHandler = async (invocation, context) => {
	const mode = invocation.args.plan === true ? 'plan' as const : 'execute' as const;
	try {
		if (['save', 'stage', 'release'].includes(invocation.commandName)) {
			if (invocation.args.plan === true) return result(invocation.commandName, 'plan', {
				authority: 'treeseed_control_plane', workflowProvider: 'github', action: invocation.commandName,
				preconditions: ['active assignment authority', 'exact GitHub PR head', 'required checks and reviews', 'compatibility evidence'],
			});
			return failure(invocation.commandName, 'policy_blocked', 'github_work_provider_not_ready', 'The governed GitHub work-provider mutation route is not active yet; legacy save/stage/release execution is disabled.');
		}
		if (invocation.commandName === 'workdays profiles validate') {
			const validation = await localProfileValidation(invocation, context);
			return validation.valid ? result(invocation.commandName, 'execute', validation) : failure(invocation.commandName, 'invalid_input', 'workday_profile_invalid', JSON.stringify(validation.diagnostics));
		}
		if (!(await confirmed(invocation, context))) return failure(invocation.commandName, 'confirmation_required', 'confirmation_required', 'Interactive confirmation is required, or pass --yes for authorized automation.');

		const localProvider = ['providers connect', 'providers disconnect', 'providers offers validate', 'providers offers plan', 'providers offers apply'].includes(invocation.commandName);
		if (localProvider) {
			if (invocation.args.plan === true && ['providers connect', 'providers disconnect'].includes(invocation.commandName)) {
				return result(invocation.commandName, 'plan', {
					action: invocation.commandName === 'providers connect' ? 'connect' : 'disconnect',
					connection: positional(invocation) ?? option(invocation, 'connection'),
					provider: option(invocation, 'provider'),
					requires: ['private Agent provider runtime', 'secret reference', 'control-plane authorization'],
				});
			}
			const delegated = await providerLocalOperation(invocation, context);
			if (delegated) return delegated;
		}

		const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
		const teamSelector = option(invocation, 'team') ?? profile.teamId ?? context.env.TREESEED_TEAM_ID?.trim() ?? null;
		const projectId = option(invocation, 'project') ?? context.env.TREESEED_PROJECT_ID?.trim() ?? null;
		const needsTeam = !invocation.commandName.startsWith('agents ') && !invocation.commandName.startsWith('plans ');
		if (needsTeam && !teamSelector) return failure(invocation.commandName, 'ambiguous_context', 'team_required', 'Select a team with --team or run from a workspace with an unambiguous team.');
		const teamId = teamSelector ? (await resolveCapacityTeam(client, teamSelector)).teamId : null;
		const first = positional(invocation);
		const idempotencyKey = `cli:${invocation.commandName.replaceAll(' ', '.')}:${teamId ?? 'global'}:${first ?? option(invocation, 'preflight') ?? 'request'}`;
		let path = '';
		let method = 'GET';
		let body: Record<string, unknown> | undefined;

		switch (invocation.commandName) {
			case 'agents list': case 'agents validate': case 'agents diff': case 'agents diagnose':
			case 'agents bindings list':
				if (!projectId) return failure(invocation.commandName, 'ambiguous_context', 'project_required', 'Select a project with --project or run from an unambiguous project workspace.');
				path = `/v1/projects/${encodeURIComponent(projectId)}/agents`; break;
			case 'agents show': case 'agents bindings show': case 'agents bindings explain':
				if (!projectId) return failure(invocation.commandName, 'ambiguous_context', 'project_required', 'Select a project with --project.');
				path = `/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(first ?? '')}`; break;
			case 'agents classes list':
				if (!projectId) return failure(invocation.commandName, 'ambiguous_context', 'project_required', 'Select a project with --project.');
				path = `/v1/projects/${encodeURIComponent(projectId)}/agent-classes${queryOptions(invocation)}`; break;
			case 'agents classes show':
				if (!projectId) return failure(invocation.commandName, 'ambiguous_context', 'project_required', 'Select a project with --project.');
				path = `/v1/projects/${encodeURIComponent(projectId)}/agent-classes/${encodeURIComponent(first ?? '')}`; break;
			case 'providers list': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-memberships${queryOptions(invocation, { providerId: option(invocation, 'provider') })}`; break;
			case 'providers show': case 'providers status': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-memberships/${encodeURIComponent(first ?? option(invocation, 'connection') ?? '')}`; break;
			case 'providers diagnose': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/availability-sessions${queryOptions(invocation, { providerId: first ?? option(invocation, 'provider') })}`; break;
			case 'providers offers show': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-memberships/${encodeURIComponent(first ?? option(invocation, 'connection') ?? '')}`; break;
			case 'providers requests list': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-requests${queryOptions(invocation)}`; break;
			case 'providers requests show': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-requests/${encodeURIComponent(first ?? '')}`; break;
			case 'providers requests approve': case 'providers requests reject':
				path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-requests/${encodeURIComponent(first ?? '')}/${invocation.commandName.endsWith('approve') ? 'approve' : 'reject'}`; method = 'POST'; body = { reason: option(invocation, 'reason'), idempotencyKey }; break;
			case 'providers credentials status': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-memberships/${encodeURIComponent(first ?? '')}/credentials${queryOptions(invocation)}`; break;
			case 'providers credentials rotate': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-memberships/${encodeURIComponent(first ?? '')}/credentials/rotate`; method = 'POST'; body = {}; break;
			case 'providers credentials revoke': {
				const credential = option(invocation, 'provider');
				if (!credential) return failure(invocation.commandName, 'invalid_input', 'credential_required', 'Pass the credential id with --provider.');
				path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-provider-memberships/${encodeURIComponent(first ?? '')}/credentials/${encodeURIComponent(credential)}/revoke`; method = 'POST'; body = {}; break;
			}
			case 'capacity status': case 'capacity explain': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/availability-sessions${queryOptions(invocation)}`; break;
			case 'capacity usage': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/usage${queryOptions(invocation, { projectId })}`; break;
			case 'capacity ledger': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/ledger${queryOptions(invocation, { projectId })}`; break;
			case 'capacity audit': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity-audit-events${queryOptions(invocation)}`; break;
			case 'plans list': {
				const decision = option(invocation, 'decision'); if (!decision) return failure(invocation.commandName, 'invalid_input', 'decision_required', 'Plans are API-derived from decisions; select one with --decision.');
				path = `/v1/decisions/${encodeURIComponent(decision)}/capacity-plans${queryOptions(invocation)}`; break;
			}
			case 'plans show': case 'plans explain': path = `/v1/capacity-plans/${encodeURIComponent(first ?? '')}`; break;
			case 'plans diff': return result(invocation.commandName, 'execute', { left: invocation.positionals[0], right: invocation.positionals[1], comparison: 'Request each immutable plan and compare their API projections.' });
			case 'workdays profiles list': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/allocation-sets${queryOptions(invocation)}`; break;
			case 'workdays profiles show': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/allocation-sets/${encodeURIComponent(first ?? '')}`; break;
			case 'workdays plan': {
				path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-runs/preflight`; method = 'POST';
				body = { schemaVersion: 'treeseed.workday-intent/v1', teamId, profileId: option(invocation, 'profile'), projects: option(invocation, 'projects') === 'all' ? 'all' : (option(invocation, 'projects') ?? '').split(',').filter(Boolean), startsAt: option(invocation, 'start') ?? new Date().toISOString(), ...(option(invocation, 'end') ? { endsAt: option(invocation, 'end') } : { durationSeconds: Number(option(invocation, 'duration') ?? 900) }), objectiveFilters: Array.isArray(invocation.args.objective) ? invocation.args.objective : [] };
				break;
			}
			case 'workdays start': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-runs`; method = 'POST'; body = { preflightId: option(invocation, 'preflight'), preflightDigest: option(invocation, 'digest'), idempotencyKey }; break;
			case 'workdays list': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-runs${queryOptions(invocation)}`; break;
			case 'workdays show': case 'workdays watch': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-runs/${encodeURIComponent(first ?? '')}`; break;
			case 'workdays pause': case 'workdays resume': case 'workdays stop': case 'workdays cancel':
				path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-runs/${encodeURIComponent(first ?? '')}`; method = 'PATCH'; body = { status: invocation.commandName.endsWith('stop') || invocation.commandName.endsWith('cancel') ? 'cancelled' : invocation.commandName.endsWith('pause') ? 'paused' : 'running', reason: option(invocation, 'reason') }; break;
			case 'workdays schedules list': case 'workdays schedules plan': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-schedules`; break;
			case 'workdays schedules show': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-schedules/${encodeURIComponent(first ?? '')}`; break;
			case 'workdays schedules start': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-schedules`; method = 'POST'; body = { profileId: option(invocation, 'profile'), projectScope: option(invocation, 'projects') ?? 'all', durationSeconds: Number(option(invocation, 'duration') ?? 900) }; break;
			case 'workdays schedules pause': case 'workdays schedules resume': case 'workdays schedules retire': path = `/v1/teams/${encodeURIComponent(teamId!)}/workday-schedules/${encodeURIComponent(first ?? '')}`; method = 'PATCH'; body = { status: invocation.commandName.endsWith('pause') ? 'paused' : invocation.commandName.endsWith('resume') ? 'active' : 'retired' }; break;
			case 'assignments list': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments${queryOptions(invocation, { projectId })}`; break;
			case 'assignments show': case 'assignments artifacts': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments/${encodeURIComponent(first ?? '')}`; break;
			case 'assignments explain': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments/${encodeURIComponent(first ?? '')}/explanation`; break;
			case 'assignments watch': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments/${encodeURIComponent(first ?? '')}`; break;
			case 'assignments retry': case 'assignments cancel': path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments/${encodeURIComponent(first ?? '')}/${invocation.commandName.endsWith('retry') ? 'requeue' : 'cancel'}`; method = 'POST'; body = { reason: option(invocation, 'reason'), idempotencyKey }; break;
			default: return failure(invocation.commandName, 'unknown_command', 'operator_route_missing', `No operator route is bound for ${invocation.commandName}.`);
		}

		if (MUTATIONS.has(invocation.commandName) && mode === 'plan') return result(invocation.commandName, 'plan', { method, path, body: body ?? null });
		const response = await capacityMarketRequest<ApiPayload>(client, path, { method, body, requireAuth: true, headers: method === 'GET' ? undefined : { 'Idempotency-Key': idempotencyKey } });
		return result(invocation.commandName, mode, response.payload ?? response);
	} catch (error) {
		return failure(invocation.commandName, 'internal_error', 'operator_command_failed', error instanceof Error ? error.message : String(error), mode);
	}
};
