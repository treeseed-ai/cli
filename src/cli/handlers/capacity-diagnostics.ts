import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';
import { capacityEnvironmentSelector, capacityStringArg } from './capacity-command-arguments.js';
import { capacityMarketRequest, capacityRecordValue, formatCapacityNumber } from './capacity-values.js';

function derivedCapacityLines(plan: Record<string, unknown>) {
	const entries = capacityRecordValue(capacityRecordValue(plan, 'derivedCapacity'), 'entries');
	if (!Array.isArray(entries) || entries.length === 0) return ['No derived native capacity entries are available yet.'];
	return entries.map((entry) => [`${capacityRecordValue(entry, 'executionProviderKind') ?? 'provider'}:${capacityRecordValue(entry, 'nativeUnit') ?? 'native'}`, `limit ${formatCapacityNumber(capacityRecordValue(entry, 'configuredNativeLimit'))}`, `observed ${formatCapacityNumber(capacityRecordValue(entry, 'observedNativeRemaining'))}`, `reserved ${formatCapacityNumber(capacityRecordValue(entry, 'activeReservedNativeAmount'))}`, `reserve ${formatCapacityNumber(capacityRecordValue(entry, 'reserveBufferPercent'))}%`, `conversion ${formatCapacityNumber(capacityRecordValue(entry, 'nativeUnitsPerCredit'))} native/credit`, `derived ${formatCapacityNumber(capacityRecordValue(entry, 'derivedAvailableCredits'))} credits`, `confidence ${capacityRecordValue(entry, 'confidence') ?? 'unknown'}`].join(' | '));
}

function grantAllocationLines(plan: Record<string, unknown>) {
	const grants = capacityRecordValue(plan, 'grants');
	if (!Array.isArray(grants) || grants.length === 0) return [];
	return grants.map((grant) => [`${capacityRecordValue(grant, 'grantScope') ?? 'grant'} ${capacityRecordValue(grant, 'environment') ?? 'all'}`, `allocation ${formatCapacityNumber(capacityRecordValue(grant, 'portfolioAllocationPercent'))}%`, `reserve pool ${formatCapacityNumber(capacityRecordValue(grant, 'reservePoolPercent'))}%`, `max daily project credits ${formatCapacityNumber(capacityRecordValue(grant, 'maxDailyProjectCredits'))}`, `overflow ${capacityRecordValue(grant, 'overflowPolicy') ?? 'soft_grant'}`, `emergency ${capacityRecordValue(grant, 'emergencyOverride') === true ? 'on' : 'off'}`].join(' | '));
}

export async function runCapacityDiagnostics(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const projectId = capacityStringArg(invocation, 'project');
	if (!projectId) return fail('Missing --project. Use `trsd capacity diagnostics --project <project-id> --environment local`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const environment = capacityEnvironmentSelector(invocation);
	const response = await capacityMarketRequest<{ ok: true; payload: Record<string, unknown> }>(client, `/v1/projects/${encodeURIComponent(projectId)}/capacity-diagnostics?environment=${encodeURIComponent(environment)}`, { requireAuth: true });
	const plan = response.payload;
	return guidedResult({
		command: 'capacity diagnostics', summary: `Capacity diagnostics for project ${projectId} in ${environment}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Project', value: projectId }, { label: 'Environment', value: environment }, { label: 'Derived credits', value: formatCapacityNumber(capacityRecordValue(capacityRecordValue(plan, 'derivedCapacity'), 'totalDerivedAvailableCredits')) }],
		sections: [{ title: 'Native projection', lines: derivedCapacityLines(plan) }, { title: 'Allocation grants', lines: grantAllocationLines(plan) }],
		report: { action: 'diagnostics', projectId, environment, market: { id: profile.id, baseUrl: profile.baseUrl }, plan },
	});
}
