import { normalizeWorkdayAgentSelection } from '@treeseed/sdk/agent-capacity';
import type { CommandContext, ParsedInvocation } from '../../../../types.js';
import { fail, guidedResult } from '../../../utilities/utils.js';
import { capacityCsvArg as csv, capacityFlagArg as flag, capacityPositiveNumberArg as positive, capacityStringArg as text } from '../../capacity-core/capacity-command-arguments.js';
import { createCapacityMarketClient, resolveCapacityTeam } from '../../capacity-core/capacity-market-context.js';
import { capacityMarketRequest } from '../../capacity-core/capacity-values.js';
import { resolveCapacityWorkdayProviderId } from '../configuration/capacity-workday-provider.js';

export const CAPACITY_WORKDAY_SCHEDULE_ACTIONS = new Set([
	'workday-schedule-plan', 'workday-schedule-create', 'workday-schedule-status', 'workday-schedule-pause',
	'workday-schedule-resume', 'workday-schedule-update', 'workday-schedule-retire', 'workday-schedule-tick',
]);

function report(action: string, value: unknown) {
	return guidedResult({ command: `capacity ${action}`, summary: `Capacity ${action} completed.`, facts: [{ label: 'Action', value: action }], report: { action, payload: value } });
}

export async function runCapacityWorkdayScheduleAction(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const teamSelector = text(invocation, 'team'); if (!teamSelector) return fail('Workday schedule commands require --team.');
	const { client } = createCapacityMarketClient(invocation, context); const { teamId, projects } = await resolveCapacityTeam(client, teamSelector);
	const scheduleId = text(invocation, 'schedule'); const base = `/v1/teams/${encodeURIComponent(teamId)}/workday-schedules`;
	if (action === 'workday-schedule-status') {
		const value = await capacityMarketRequest(client, scheduleId ? `${base}/${encodeURIComponent(scheduleId)}` : base, { requireAuth: true }); return report(action, value);
	}
	const execute = flag(invocation, 'execute');
	if (action === 'workday-schedule-plan' || action === 'workday-schedule-create') {
		const selectedProjects = csv(invocation, 'projects', ['market']);
		const projectIds = projects.filter((project) => selectedProjects.includes(String(project.slug ?? project.id))).map((project) => String(project.id));
		if (projectIds.length !== selectedProjects.length) return fail('One or more scheduled project selectors are unavailable to the team.');
		const classSelectors = csv(invocation, 'agentClasses', []);
		const provider = await resolveCapacityWorkdayProviderId(client, teamId, text(invocation, 'provider') ?? 'local');
		const durationSeconds = positive(invocation, 'durationSeconds', 1800); const maxActiveAssignments = positive(invocation, 'maxActiveAssignments', 3); const planningOnly = flag(invocation, 'planningOnly');
		const body = { purpose: text(invocation, 'purpose') ?? 'Recurring TreeSeed Guide editorial workday', projectIds, capacityProviderId: provider.providerId,
			agentSelection: normalizeWorkdayAgentSelection({ classIds: classSelectors.filter((value) => value.includes(':')), classSlugs: classSelectors.filter((value) => !value.includes(':')), agentSlugs: csv(invocation, 'agents', []), mode: text(invocation, 'selectionMode') }),
			cadenceSeconds: positive(invocation, 'cadenceSeconds', 3600), durationSeconds, maxActiveAssignments, availableSeconds: positive(invocation, 'availableSeconds', durationSeconds * maxActiveAssignments), planningOnly,
			timePolicy: { cooperativePlanningPercent: positive(invocation, 'planningPercent', planningOnly ? 90 : 25), governedExecutionPercent: planningOnly ? 0 : positive(invocation, 'executionPercent', 65), reservePercent: positive(invocation, 'reservePercent', 10) },
			publicationPolicy: { bookIds: csv(invocation, 'bookIds', ['treeseed-guide']), target: text(invocation, 'target') === 'production' ? 'production' : 'staging', cohortMode: 'accepted', requireTechnicalReview: true, requireAudienceReview: true, requireGraphReviewWhenStructural: true, simulatedHumanApproval: flag(invocation, 'simulateHuman') },
			nextRunAt: text(invocation, 'nextRunAt') ?? new Date().toISOString() };
		if (action === 'workday-schedule-plan' || !execute) return report('workday-schedule-plan', { mode: 'plan', body });
		return report(action, await capacityMarketRequest(client, base, { method: 'POST', body, requireAuth: true }));
	}
	if (!scheduleId) return fail(`${action} requires --schedule.`);
	if (!execute) return fail(`${action} is mutating; pass --execute.`);
	if (action === 'workday-schedule-tick') return report(action, await capacityMarketRequest(client, `${base}/${encodeURIComponent(scheduleId)}/tick`, { method: 'POST', body: {}, requireAuth: true }));
	const current = await capacityMarketRequest<Record<string, unknown>>(client, `${base}/${encodeURIComponent(scheduleId)}`, { requireAuth: true });
	const payload = current.payload && typeof current.payload === 'object' ? current.payload as Record<string, unknown> : {};
	const body: Record<string, unknown> = { stateVersion: payload.stateVersion };
	if (action === 'workday-schedule-pause') body.status = 'paused';
	else if (action === 'workday-schedule-resume') { body.status = 'active'; body.nextRunAt = new Date().toISOString(); }
	else if (action === 'workday-schedule-retire') body.status = 'completed';
	else { body.purpose = text(invocation, 'purpose') ?? payload.purpose; body.cadenceSeconds = positive(invocation, 'cadenceSeconds', Number(payload.cadenceSeconds ?? 3600)); }
	return report(action, await capacityMarketRequest(client, `${base}/${encodeURIComponent(scheduleId)}`, { method: 'PATCH', body, requireAuth: true }));
}
