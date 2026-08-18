import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityEnvironmentSelector, capacityStringArg } from '../capacity-core/capacity-command-arguments.js';
import { capacityMarketRequest, capacityRecordValue, formatCapacityNumber } from '../capacity-core/capacity-values.js';

function nativeCapacityLines(plan: Record<string, unknown>) {
	const entries = capacityRecordValue(capacityRecordValue(plan, 'nativeCapacity'), 'entries');
	if (!Array.isArray(entries) || entries.length === 0) return ['No provider-native capacity observations are available yet.'];
	return entries.map((entry) => [`${capacityRecordValue(entry, 'executionProviderKind') ?? 'provider'}:${capacityRecordValue(entry, 'nativeUnit') ?? 'native'}`, `limit ${formatCapacityNumber(capacityRecordValue(entry, 'configuredNativeLimit'))}`, `observed ${formatCapacityNumber(capacityRecordValue(entry, 'observedNativeRemaining'))}`, `reserved ${formatCapacityNumber(capacityRecordValue(entry, 'activeReservedNativeAmount'))}`, `consumed ${formatCapacityNumber(capacityRecordValue(entry, 'activeConsumedNativeAmount'))}`, `available ${formatCapacityNumber(capacityRecordValue(entry, 'availableNativeAmount'))}`, `reserve ${formatCapacityNumber(capacityRecordValue(entry, 'reserveBufferPercent'))}%`, `confidence ${capacityRecordValue(entry, 'confidence') ?? 'unknown'}`].join(' | '));
}

function grantAllocationLines(plan: Record<string, unknown>) {
	const grants = capacityRecordValue(plan, 'grants');
	if (!Array.isArray(grants) || grants.length === 0) return [];
	return grants.map((grant) => [`${capacityRecordValue(grant, 'projectId') ?? 'portfolio'} ${capacityRecordValue(grant, 'environment') ?? 'all'}`, `daily ${formatCapacityNumber(capacityRecordValue(grant, 'dailyAgentSecondsLimit'))} agent-seconds`, `monthly ${formatCapacityNumber(capacityRecordValue(grant, 'monthlyAgentSecondsLimit'))} agent-seconds`, `concurrency ${formatCapacityNumber(capacityRecordValue(grant, 'maxConcurrentAssignments'))}`, `unmetered ${capacityRecordValue(grant, 'unmetered') === true ? 'yes' : 'no'}`].join(' | '));
}

export async function runCapacityDiagnostics(invocation: ParsedInvocation, context: CommandContext) {
	const projectId = capacityStringArg(invocation, 'project');
	if (!projectId) return fail('Missing --project. Use `trsd capacity diagnostics --project <project-id> --environment local`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const environment = capacityEnvironmentSelector(invocation);
	const response = await capacityMarketRequest<{ ok: true; payload: Record<string, unknown> }>(client, `/v1/projects/${encodeURIComponent(projectId)}/capacity-diagnostics?environment=${encodeURIComponent(environment)}`, { requireAuth: true });
	const plan = response.payload;
	return guidedResult({
		command: 'capacity diagnostics', summary: `Capacity diagnostics for project ${projectId} in ${environment}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Project', value: projectId }, { label: 'Environment', value: environment }, { label: 'Daily agent time remaining', value: formatCapacityNumber(capacityRecordValue(capacityRecordValue(plan, 'remaining'), 'dailyAgentSeconds')) }],
		sections: [{ title: 'Provider-native capacity', lines: nativeCapacityLines(plan) }, { title: 'Agent-time grants', lines: grantAllocationLines(plan) }],
		report: { action: 'diagnostics', projectId, environment, market: { id: profile.id, baseUrl: profile.baseUrl }, plan },
	});
}
