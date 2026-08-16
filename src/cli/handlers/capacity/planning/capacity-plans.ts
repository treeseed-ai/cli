import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityStringArg as text } from '../capacity-core/capacity-command-arguments.js';

type JsonRecord = Record<string, unknown>;

export const CAPACITY_PLAN_ACTIONS = new Set([
	'capacity-plan-create',
	'capacity-plan-accept',
	'capacity-plan-request-revision',
	'capacity-plan-schedule',
	'capacity-plan-supersede',
]);

function csv(invocation: ParsedInvocation, name: string) {
	const value = text(invocation, name);
	return value ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))] : [];
}

async function document(invocation: ParsedInvocation, context: CommandContext) {
	const inline = text(invocation, 'document');
	const file = text(invocation, 'file');
	if (!inline && !file) return {};
	const source = inline ?? await readFile(resolve(context.cwd, file!), 'utf8');
	const value = parseYaml(source);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Capacity plan input must be a YAML or JSON object.');
	}
	return value as JsonRecord;
}

function transitionName(action: string) {
	return action.slice('capacity-plan-'.length) as 'accept' | 'request-revision' | 'schedule' | 'supersede';
}

function mutationInput(invocation: ParsedInvocation, input: JsonRecord, idempotencyKey: string) {
	return {
		...input,
		...(text(invocation, 'allocation') ? { allocationSetId: text(invocation, 'allocation') } : {}),
		...(text(invocation, 'workday') ? { workDayId: text(invocation, 'workday') } : {}),
		...(text(invocation, 'reason') ? { reason: text(invocation, 'reason') } : {}),
		idempotencyKey,
	};
}

async function confirmBindingSimulation(action: string, invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.args.simulateHuman !== true || action === 'capacity-plan-request-revision') return true;
	if (invocation.args.yes === true) return true;
	return context.confirm?.(`Confirm simulated-human ${transitionName(action)} for this capacity plan?`, 'yes') ?? false;
}

export async function runCapacityPlanAction(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const create = action === 'capacity-plan-create';
	const decisionId = text(invocation, 'decision');
	const capacityPlanId = text(invocation, 'capacityPlan') ?? text(invocation, 'plan');
	const projectId = text(invocation, 'project');
	if (create && !decisionId) return fail('Missing --decision for capacity-plan-create.');
	if (create && !projectId) return fail('Missing --project for capacity-plan-create.');
	if (!create && !capacityPlanId) return fail(`Missing --capacity-plan for ${action}.`);
	const plan = invocation.args.plan === true;
	const execute = invocation.args.execute === true;
	if (plan === execute) return fail(`Capacity ${action} is mutating. Choose exactly one of --plan or --execute.`);
	if (invocation.args.simulateHuman === true && (!text(invocation, 'workday') || !text(invocation, 'reason'))) {
		return fail(`Capacity ${action} simulated-human authority requires --workday and --reason.`);
	}
	if (!await confirmBindingSimulation(action, invocation, context)) {
		return fail(`Capacity ${action} simulated-human authority requires explicit confirmation; use --yes for noninteractive automation.`);
	}
	const idempotencyKey = text(invocation, 'idempotencyKey') ?? `cli:${action}:${randomUUID()}`;
	const supplied = await document(invocation, context);
	const executionInputIds = csv(invocation, 'executionInputs');
	const request = mutationInput(invocation, {
		...supplied,
		...(create ? { projectId } : {}),
		...(create && executionInputIds.length ? { decisionExecutionInputIds: executionInputIds } : {}),
		...(invocation.args.simulateHuman === true ? {
			simulation: {
				interactionMode: 'ai_operator_simulation',
				workdayId: text(invocation, 'workday'),
				reason: text(invocation, 'reason'),
				clientSurface: 'trsd-cli',
			},
		} : {}),
	}, idempotencyKey);
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
	const subjectId = create ? decisionId! : capacityPlanId!;
	if (plan) return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity plan ${create ? 'creation' : transitionName(action)} preview rendered without mutation.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: create ? 'Decision' : 'Capacity plan', value: subjectId }],
		report: { mode: 'plan', action, decisionId: decisionId ?? null, capacityPlanId: capacityPlanId ?? null, request },
	});
	const response = create
		? await client.createDecisionCapacityPlan(decisionId!, request)
		: action === 'capacity-plan-accept'
			? await client.acceptCapacityPlan(capacityPlanId!, request)
			: action === 'capacity-plan-request-revision'
				? await client.requestCapacityPlanRevision(capacityPlanId!, request)
				: action === 'capacity-plan-schedule'
					? await client.scheduleCapacityPlan(capacityPlanId!, request)
					: await client.supersedeCapacityPlan(capacityPlanId!, request);
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity plan ${create ? 'created' : `${transitionName(action)} transition completed`}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: create ? 'Decision' : 'Capacity plan', value: subjectId }],
		report: { mode: 'live', action, decisionId: decisionId ?? null, capacityPlanId: capacityPlanId ?? null, idempotencyKey, payload: response.payload },
	});
}
