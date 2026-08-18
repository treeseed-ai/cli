import { randomUUID } from 'node:crypto';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityStringArg as text } from '../capacity-core/capacity-command-arguments.js';

export const CAPACITY_OVERRUN_ACTIONS = new Set(['overrun-approve', 'overrun-reject']);

export async function runCapacityOverrunAction(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const teamId = text(invocation, 'team'); const reservationId = text(invocation, 'reservation');
	if (!teamId) return fail(`Missing --team for capacity ${action}.`);
	if (!reservationId) return fail(`Missing --reservation for capacity ${action}.`);
	const plan = invocation.args.plan === true; const execute = invocation.args.execute === true;
	if (plan === execute) return fail(`Capacity ${action} is mutating. Choose exactly one of --plan or --execute.`);
	const decision = action === 'overrun-approve' ? 'approve' : 'reject';
	const body = { idempotencyKey: text(invocation, 'idempotencyKey') ?? `cli:${action}:${randomUUID()}` };
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
	if (plan) return guidedResult({
		command: `capacity ${action}`, summary: `Capacity ${action} plan rendered without mutation.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: teamId }, { label: 'Reservation', value: reservationId }],
		report: { mode: 'plan', action, teamId, reservationId, request: body },
	});
	const response = await client.decideCapacityOverrun(teamId, reservationId, decision, body);
	return guidedResult({
		command: `capacity ${action}`, summary: `Reservation ${reservationId} overrun ${decision} completed.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: teamId }, { label: 'Reservation', value: reservationId }],
		report: { mode: 'live', action, teamId, reservationId, payload: response.payload },
	});
}
