import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';
import { randomUUID } from 'node:crypto';
import { capacityNumberArg as numberArg, capacityStringArg as stringArg } from './capacity-command-arguments.js';

export const CAPACITY_WORKDAY_ACTIONS = new Set([
	'workday-create',
	'workday-start',
	'workday-pause',
	'workday-resume',
	'workday-tick',
	'workday-complete',
	'workday-cancel',
	'workday-status',
	'workday-summary',
]);

function executeRequested(invocation: TreeseedParsedInvocation) {
	return invocation.args.execute === true;
}

function planRequested(invocation: TreeseedParsedInvocation) {
	return invocation.args.plan === true;
}

function planResult(action: string, profile: { id: string; baseUrl: string }, request: Record<string, unknown>) {
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity workday ${action.replace('workday-', '')} plan rendered without mutation.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }],
		sections: [{ title: 'Request', lines: [JSON.stringify(request, null, 2)] }],
		report: { mode: 'plan', action, request },
	});
}

type WorkdaySummaryEvidence = 'assignments' | 'mode-runs' | 'reservations' | 'usage-actuals' | 'ledger-entries';

export function parseCapacityWorkdaySummaryOptions(args: Record<string, unknown>): {
	options?: { evidence: WorkdaySummaryEvidence | null; limit?: number; cursor: string | null };
	error?: string;
} {
	const rawEvidence = args.evidence;
	const evidence = typeof rawEvidence === 'string' && rawEvidence.trim() ? rawEvidence.trim() : null;
	const allowedEvidence = new Set<WorkdaySummaryEvidence>(['assignments', 'mode-runs', 'reservations', 'usage-actuals', 'ledger-entries']);
	if (evidence && !allowedEvidence.has(evidence as WorkdaySummaryEvidence)) {
		return { error: 'Invalid --evidence. Use assignments, mode-runs, reservations, usage-actuals, or ledger-entries.' };
	}
	const rawCursor = args.cursor;
	const cursor = typeof rawCursor === 'string' && rawCursor.trim() ? rawCursor.trim() : null;
	if (cursor && !evidence) return { error: '--cursor requires --evidence for capacity workday-summary.' };
	const rawLimit = args.limit;
	const limit = typeof rawLimit === 'number' ? rawLimit : typeof rawLimit === 'string' && rawLimit.trim() ? Number(rawLimit) : null;
	if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
		return { error: '--limit must be an integer from 1 through 200.' };
	}
	return {
		options: {
			evidence: evidence as WorkdaySummaryEvidence | null,
			limit: limit ?? undefined,
			cursor,
		},
	};
}

export async function runCapacityWorkdayAction(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
	const workdayId = stringArg(invocation, 'workday');
	if (action === 'workday-tick') {
		const teamId = stringArg(invocation, 'team');
		if (!teamId) return fail('Missing --team for capacity workday-tick.');
		if (!workdayId) return fail('Missing --workday for capacity workday-tick.');
		if (planRequested(invocation) === executeRequested(invocation)) return fail('Capacity workday-tick is mutating. Choose exactly one of --plan or --execute.');
		const request = { teamId, workdayRunId: workdayId };
		if (planRequested(invocation)) return planResult(action, profile, request);
		const response = await client.tickWorkdayRun(teamId, workdayId, {
			idempotencyKey: stringArg(invocation, 'idempotencyKey') ?? `cli:workday-tick:${randomUUID()}`,
		});
		return guidedResult({
			command: `capacity ${action}`, summary: `Ticked capacity workday run ${workdayId}.`,
			facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: teamId }, { label: 'Workday run', value: workdayId }],
			report: { action, mode: 'live', payload: response.payload },
		});
	}
	if (action === 'workday-status' || action === 'workday-summary') {
		if (!workdayId) return fail(`Missing --workday for capacity ${action}.`);
		const parsed = action === 'workday-summary' ? parseCapacityWorkdaySummaryOptions(invocation.args) : { options: undefined };
		if (parsed.error) return fail(parsed.error);
		const response = action === 'workday-summary'
			? await client.workdaySummary(workdayId, parsed.options)
			: await client.workday(workdayId);
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Read capacity workday ${workdayId}.`,
			facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Workday', value: workdayId }],
			report: { action, workdayId, payload: response.payload },
		});
	}

	if (planRequested(invocation) && executeRequested(invocation)) return fail('Choose exactly one of --plan or --execute.');
	if (!planRequested(invocation) && !executeRequested(invocation)) return fail(`Capacity ${action} is mutating. Pass --plan to inspect it or --execute to apply it.`);

	if (action === 'workday-create') {
		const projectId = stringArg(invocation, 'project');
		if (!projectId) return fail('Missing --project for capacity workday-create.');
		const availableCredits = numberArg(invocation, 'availableCredits');
		if (availableCredits === null || availableCredits <= 0) return fail('A positive --available-credits value is required.');
		const request = {
			projectId,
			id: workdayId ?? undefined,
			environment: stringArg(invocation, 'environment') ?? 'local',
			allocationSetId: stringArg(invocation, 'allocation') ?? undefined,
			availableCredits,
			status: 'draft',
			metadata: { source: 'treeseed_cli' },
		};
		if (planRequested(invocation)) return planResult(action, profile, request);
		const response = await client.createWorkday(request, stringArg(invocation, 'idempotencyKey') ?? `cli:workday-create:${randomUUID()}`);
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Created capacity workday ${String(response.payload.id ?? '')}.`,
			facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Project', value: projectId }, { label: 'Available credits', value: availableCredits }],
			report: { action, mode: 'live', payload: response.payload },
		});
	}

	if (!workdayId) return fail(`Missing --workday for capacity ${action}.`);
	const transition = action.replace('workday-', '') as 'start' | 'pause' | 'resume' | 'complete' | 'cancel';
	const request = { workdayId, transition };
	if (planRequested(invocation)) return planResult(action, profile, request);
	const key = stringArg(invocation, 'idempotencyKey') ?? `cli:workday-${transition}:${randomUUID()}`;
	const response = transition === 'start' ? await client.startWorkday(workdayId, key)
		: transition === 'pause' ? await client.pauseWorkday(workdayId, key)
			: transition === 'resume' ? await client.resumeWorkday(workdayId, key)
				: transition === 'complete' ? await client.completeWorkday(workdayId, key)
					: await client.cancelWorkday(workdayId, key);
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity workday ${workdayId} transitioned via ${transition}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Workday', value: workdayId }, { label: 'Transition', value: transition }],
		report: { action, mode: 'live', payload: response.payload },
	});
}
