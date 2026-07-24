import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityPositiveNumberArg, capacityStringArg } from './capacity-command-arguments.js';
import { createCapacityMarketClient, resolveCapacityTeam } from './capacity-market-context.js';
import { capacityMarketRequest, capacityQuery, isCapacityRecord } from './capacity-values.js';
import { capacityInspectionLines, decorateCapacityInspectionRecords } from './capacity-inspection-projection.js';

export const CAPACITY_MARKET_INSPECTION_ACTIONS = new Set(['availability-sessions', 'assignments', 'mode-runs', 'decision-planning', 'execution-inputs', 'capacity-plans', 'capacity-plan', 'workday', 'fallback-outputs', 'treedx-proxy-audit']);

const stringArg = capacityStringArg;
const positiveNumberArg = capacityPositiveNumberArg;
const createCapacityWorkdayMarketClient = createCapacityMarketClient;
const resolveCapacityWorkdayTeam = resolveCapacityTeam;
const marketRequest = capacityMarketRequest;
const queryFromFilters = capacityQuery;
const isRecord = isCapacityRecord;
const listLines = capacityInspectionLines;
const decorateInspectionRecords = decorateCapacityInspectionRecords;

export async function runCapacityMarketInspection(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const teamId = stringArg(invocation, 'team');
	const projectId = stringArg(invocation, 'project');
	const providerId = stringArg(invocation, 'provider');
	const status = stringArg(invocation, 'status');
	const mode = stringArg(invocation, 'mode');
	const assignmentId = stringArg(invocation, 'assignment');
	const executionProviderId = stringArg(invocation, 'execution-provider');
	const limit = positiveNumberArg(invocation, 'limit', 50);
	const cursor = stringArg(invocation, 'cursor');
	const decisionId = stringArg(invocation, 'decision');
	const capacityPlanId = stringArg(invocation, 'capacity-plan') ?? stringArg(invocation, 'plan');
	const workdayId = stringArg(invocation, 'workday');
	if ((action === 'availability-sessions' || action === 'assignments') && !teamId) {
		return fail(`Missing --team. Use \`trsd capacity ${action} --team <team-id> --json\`.`);
	}
	if ((action === 'mode-runs' || action === 'fallback-outputs' || action === 'treedx-proxy-audit') && !projectId) {
		return fail(`Missing --project. Use \`trsd capacity ${action} --project <project-id> --json\`.`);
	}
	if ((action === 'decision-planning' || action === 'execution-inputs' || action === 'capacity-plans') && !decisionId) {
		return fail(`Missing --decision. Use \`trsd capacity ${action} --decision <decision-id> --json\`.`);
	}
	if (action === 'capacity-plan' && !capacityPlanId) {
		return fail('Missing --capacity-plan. Use `trsd capacity capacity-plan --capacity-plan <capacity-plan-id> --json`.');
	}
	if (action === 'workday' && !workdayId) {
		return fail(`Missing --workday. Use \`trsd capacity ${action} --workday <workday-id> --json\`.`);
	}
	const { profile, client, authMode } = createCapacityWorkdayMarketClient(invocation, context);
	const resolvedTeam = teamId
		? await resolveCapacityWorkdayTeam(client, teamId).catch(() => ({ teamId, teamSelector: teamId, team: null, projects: [] }))
		: null;
	const resolvedTeamId = resolvedTeam?.teamId ?? teamId;
	let path = '';
	let scopeLabel = '';
	if (action === 'availability-sessions') {
		path = `/v1/teams/${encodeURIComponent(resolvedTeamId!)}/capacity/availability-sessions${queryFromFilters({ providerId, status, limit, cursor })}`;
		scopeLabel = `team ${resolvedTeamId}`;
	} else if (action === 'assignments') {
		path = `/v1/teams/${encodeURIComponent(resolvedTeamId!)}/capacity/assignments${queryFromFilters({
			projectId,
			providerId,
			status,
			assignmentId,
			workdayId,
			executionProviderId,
			limit,
			cursor,
		})}`;
		scopeLabel = `team ${resolvedTeamId}`;
	} else if (action === 'mode-runs') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/agent-mode-runs${queryFromFilters({ mode, assignmentId, limit, cursor })}`;
		scopeLabel = `project ${projectId}`;
	} else if (action === 'fallback-outputs') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/agent-fallback-outputs${queryFromFilters({ mode, status, assignmentId, limit, cursor })}`;
		scopeLabel = `project ${projectId}`;
	} else if (action === 'treedx-proxy-audit') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/treedx-proxy-audit${queryFromFilters({ assignmentId, limit, cursor })}`;
		scopeLabel = `project ${projectId}`;
	} else if (action === 'decision-planning') {
		path = `/v1/decisions/${encodeURIComponent(decisionId!)}/planning-status`;
		scopeLabel = `decision ${decisionId}`;
	} else if (action === 'execution-inputs') {
		path = `/v1/decisions/${encodeURIComponent(decisionId!)}/execution-inputs${queryFromFilters({ status })}`;
		scopeLabel = `decision ${decisionId}`;
	} else if (action === 'capacity-plans') {
		path = `/v1/decisions/${encodeURIComponent(decisionId!)}/capacity-plans${queryFromFilters({ status })}`;
		scopeLabel = `decision ${decisionId}`;
	} else if (action === 'capacity-plan') {
		path = `/v1/capacity-plans/${encodeURIComponent(capacityPlanId!)}`;
		scopeLabel = `capacity plan ${capacityPlanId}`;
	} else if (action === 'workday') {
		path = `/v1/workdays/${encodeURIComponent(workdayId!)}`;
		scopeLabel = `workday ${workdayId}`;
	}
	const response = await marketRequest<{
		ok: true;
		payload: unknown[] | Record<string, unknown>;
	}>(client, path, { requireAuth: true });
	const page = isRecord(response.payload) && Array.isArray(response.payload.items) && isRecord(response.payload.page)
		? response.payload.page
		: null;
	const records = page
		? response.payload.items as unknown[]
		: Array.isArray(response.payload)
			? response.payload
			: response.payload
				? [response.payload]
				: [];
	const decoratedRecords = decorateInspectionRecords(action, records);
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Read ${records.length} ${action.replace(/-/gu, ' ')} record${records.length === 1 ? '' : 's'} for ${scopeLabel}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Auth', value: authMode === 'local_acceptance_admin' ? 'local_acceptance_admin' : 'session' }, { label: 'Scope', value: scopeLabel }, { label: 'Records', value: records.length }, ...(providerId ? [{ label: 'Provider filter', value: providerId }] : []), ...(status ? [{ label: 'Status filter', value: status }] : []), ...(mode ? [{ label: 'Mode filter', value: mode }] : []), ...(assignmentId ? [{ label: 'Assignment filter', value: assignmentId }] : []), ...(page ? [{ label: 'More records', value: page.hasMore === true ? 'yes' : 'no' }] : [])],
		sections: [
			{ title: 'Records', lines: listLines(decoratedRecords, action) },
			{
				title: 'Boundary',
				lines: ['Read-only inspection. Assignment creation, selection, and provider lifecycle remain owned by API coordination and reconciled provider runtime.'],
			},
		],
		report: {
			action,
			market: { id: profile.id, baseUrl: profile.baseUrl },
			scope: { teamId, projectId },
			filters: { providerId, status, mode, assignmentId, workdayId, executionProviderId, limit, cursor, capacityPlanId },
			records: decoratedRecords,
			...(page ? { page } : {}),
		},
	});
}
