import { randomUUID } from 'node:crypto';
import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';
import { capacityStringArg as text } from './capacity-command-arguments.js';

export const CAPACITY_ASSIGNMENT_ACTIONS = new Set(['assignment-cancel', 'assignment-requeue']);

export async function runCapacityAssignmentAction(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const teamId = text(invocation, 'team'); const assignmentId = text(invocation, 'assignment');
	if (!teamId) return fail(`Missing --team for capacity ${action}.`);
	if (!assignmentId) return fail(`Missing --assignment for capacity ${action}.`);
	const plan = invocation.args.plan === true; const execute = invocation.args.execute === true;
	if (plan === execute) return fail(`Capacity ${action} is mutating. Choose exactly one of --plan or --execute.`);
	const idempotencyKey = text(invocation, 'idempotencyKey') ?? `cli:${action}:${randomUUID()}`;
	const body = { idempotencyKey, reason: text(invocation, 'reason') ?? undefined };
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
	if (plan) return guidedResult({
		command: `capacity ${action}`, summary: `Capacity ${action.replace('assignment-', '')} plan rendered without mutation.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: teamId }, { label: 'Assignment', value: assignmentId }],
		report: { mode: 'plan', action, teamId, assignmentId, request: body },
	});
	const operation = action.replace('assignment-', '');
	const response = action === 'assignment-cancel'
		? await client.cancelCapacityAssignment(teamId, assignmentId, body)
		: await client.requeueCapacityAssignment(teamId, assignmentId, body);
	return guidedResult({
		command: `capacity ${action}`, summary: `Assignment ${assignmentId} ${operation} operation completed.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: teamId }, { label: 'Assignment', value: assignmentId }],
		report: { mode: 'live', action, teamId, assignmentId, payload: response.payload },
	});
}
