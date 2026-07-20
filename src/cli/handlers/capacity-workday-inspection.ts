import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { renderWorkdayLogInk } from '../workday-log-ui.js';
import { guidedResult, fail } from './utils.js';
import { capacityFlagArg as boolArg, capacityPositiveNumberArg as positiveNumberArg, capacityStringArg as stringArg } from './capacity-command-arguments.js';
import { createCapacityMarketClient, resolveCapacityTeam } from './capacity-market-context.js';
import { capacityCollectionItems as collectionItems, capacityMarketRequest as marketRequest, capacityQuery as queryFromFilters, capacityRecordValue as recordValue, isCapacityRecord as isRecord } from './capacity-values.js';
import { redactCapacityOutputSecrets } from './capacity-output-security.js';
import { contextPackSummaries, dedupeExecutionRunRecords, groupWorkdayExecutionRecords, normalizeExecutionRunRecord, workdaySummaryFacts } from './capacity-workday-log-records.js';
import { enrichWorkdayLogRecordsWithModeRuns, executionRunsForAssignments, workdayAssignmentIdsForLog, workdayLogDetailLines, workdayTimelineBlock } from './capacity-workday-log.js';

function yamlScalar(value: unknown) {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
	if (typeof value !== 'string') return JSON.stringify(value);
	if (value.length === 0) return "''";
	if (/^[A-Za-z0-9_.:/@-]+$/u.test(value) && !['true', 'false', 'null'].includes(value.toLowerCase())) return value;
	return JSON.stringify(value);
}

function toYaml(value: unknown, indent = 0): string {
	const pad = ' '.repeat(indent);
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		return value.map((entry) => {
			if (entry && typeof entry === 'object') {
				const nested = toYaml(entry, indent + 2);
				return `${pad}-${nested.startsWith('\n') ? nested : `\n${nested}`}`;
			}
			return `${pad}- ${yamlScalar(entry)}`;
		}).join('\n');
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return '{}';
		return entries.map(([key, entryValue]) => {
			if (entryValue && typeof entryValue === 'object') {
				const nested = toYaml(entryValue, indent + 2);
				return `${pad}${key}:${nested === '[]' || nested === '{}' ? ` ${nested}` : `\n${nested}`}`;
			}
			return `${pad}${key}: ${yamlScalar(entryValue)}`;
		}).join('\n');
	}
	return `${pad}${yamlScalar(value)}`;
}

export async function runExecutionRunsInspection(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext, options: { action?: 'execution-runs' | 'workday-log' } = {}) {
	const action = options.action ?? 'execution-runs';
	const teamSelector = stringArg(invocation, 'team');
	if (!teamSelector) {
		return fail(`Missing --team. Use \`trsd capacity ${action} --team <team-id-or-slug>${action === 'workday-log' ? ' --workday <workday-id>' : ''} --format yaml\`.`);
	}
	const projectId = stringArg(invocation, 'project');
	const providerId = stringArg(invocation, 'provider');
	const status = stringArg(invocation, 'status');
	const mode = stringArg(invocation, 'mode');
	const assignmentId = stringArg(invocation, 'assignment');
	const workdayId = stringArg(invocation, 'workday');
	if (action === 'workday-log' && !workdayId) {
		return fail('Missing --workday. Use `trsd capacity workday-log --team <team-id-or-slug> --workday <workday-id> --json`.');
	}
	const executionProviderId = stringArg(invocation, 'execution-provider');
	const kindFilter = stringArg(invocation, 'kind');
	const outputFormat = stringArg(invocation, 'format');
	const maxRuns = positiveNumberArg(invocation, 'limit', 200);
	const rawLimit = Math.min(200, action === 'workday-log' ? Math.max(maxRuns * 100, maxRuns) : maxRuns);
	const { profile, client, authMode } = createCapacityMarketClient(invocation, context);
	const team = await resolveCapacityTeam(client, teamSelector);
	const teamId = team.teamId;
	const assignmentScopedRows = action === 'workday-log' && workdayId && !assignmentId
		? await executionRunsForAssignments(
			client,
			teamId,
			(await workdayAssignmentIdsForLog(client, teamId, workdayId, providerId ?? null)).slice(0, maxRuns),
		)
		: null;
	const response = assignmentScopedRows
		? { payload: assignmentScopedRows }
		: await marketRequest<{ ok: true; payload: unknown }>(
			client,
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/execution-runs${queryFromFilters({
				projectId,
				providerId,
				status,
				mode,
				assignmentId,
				workdayId,
				executionProviderId,
				limit: rawLimit,
			})}`,
			{ requireAuth: true },
		);
	const rows = collectionItems(response.payload)
		.filter(isRecord)
		.filter((row) => !kindFilter || String(recordValue(recordValue(row, 'executionProvider'), 'id') ?? '').toLowerCase().includes(kindFilter.toLowerCase()))
		.map((row) => normalizeExecutionRunRecord(redactCapacityOutputSecrets(row) as Record<string, unknown>));
	const projectedRows = action === 'workday-log'
		? dedupeExecutionRunRecords(rows)
		: dedupeExecutionRunRecords(rows).slice(0, maxRuns);
	const forensicRows = action === 'workday-log'
		? await enrichWorkdayLogRecordsWithModeRuns(client, groupWorkdayExecutionRecords(projectedRows).slice(0, maxRuns))
		: projectedRows;
	const effectiveFormat = outputFormat ?? (context.outputFormat === 'json' ? 'json' : null);
	if (effectiveFormat === 'yaml') {
		return {
			exitCode: 0,
			stdout: [toYaml(forensicRows)],
			report: {
				action,
				ok: true,
				market: { id: profile.id, baseUrl: profile.baseUrl },
				authMode,
				scope: { teamId, projectId },
				filters: { providerId, status, mode, assignmentId, workdayId, executionProviderId, kind: kindFilter },
				records: forensicRows,
				yaml: toYaml(forensicRows),
			},
		};
	}
	if (effectiveFormat === 'json') {
		return {
			exitCode: 0,
			stdout: [JSON.stringify(forensicRows, null, 2)],
			report: { action, ok: true, records: forensicRows },
		};
	}
	const timelineBlocks = forensicRows.map(workdayTimelineBlock);
	const timelineLines = timelineBlocks.flatMap((block, index) => index === 0 ? block : ['', ...block]);
	const treeLines: string[] = [];
	const byProject = new Map<string, Record<string, unknown>[]>();
	for (const row of forensicRows) {
		const agent = recordValue(row, 'agent') as Record<string, unknown> | undefined;
		const key = String(agent?.projectSlug ?? agent?.projectId ?? 'unknown-project');
		byProject.set(key, [...(byProject.get(key) ?? []), row]);
	}
	for (const [project, projectRows] of byProject) {
		treeLines.push(project);
		for (const row of projectRows) {
			const facts = workdaySummaryFacts(row);
			const assignment = facts.assignment;
			const inputTokens = recordValue(facts.tokenCounts, 'inputTokens') ?? recordValue(facts.usage, 'inputTokens');
			const outputTokens = recordValue(facts.tokenCounts, 'outputTokens') ?? recordValue(facts.usage, 'outputTokens');
			const contextPacks = contextPackSummaries(facts.workPackage);
			treeLines.push(`  ${String(recordValue(assignment, 'workdayId') ?? 'workday?')}`);
			treeLines.push(`    ${workdayHumanAssignmentLabel(row)}`);
			treeLines.push(`      agent: ${String(recordValue(facts.agent, 'agentId') ?? 'agent?')} (${String(recordValue(facts.agent, 'projectAgentClassId') ?? recordValue(facts.agent, 'classSlug') ?? 'class?')}, handler=${String(recordValue(facts.agent, 'handlerId') ?? 'n/a')})`);
			treeLines.push(`      status: ${String(recordValue(row, 'status') ?? 'unknown')} duration=${compactDuration(facts.durationMs ?? recordValue(facts.timing, 'durationMs'))} telemetry=${facts.modeRuns.length}`);
			treeLines.push(`      ai: provider=${String(recordValue(facts.codex, 'provider') ?? recordValue(facts.executionProvider, 'id') ?? 'codex')} model=${String(recordValue(facts.request, 'model') ?? 'n/a')} tokens=${String(inputTokens ?? 'n/a')}/${String(outputTokens ?? 'n/a')} wall=${compactDuration(recordValue(facts.usage, 'wallMs'))}`);
			treeLines.push(`      context: coreObjective=${String(recordValue(facts.contextDiagnostics, 'coreObjectiveIncluded') ?? 'n/a')} packs=${contextPacks.length} treedxCalls=${facts.treeDxCalls.length}`);
			for (const artifact of facts.artifacts) {
				treeLines.push(`      content: ${String(recordValue(artifact, 'artifactKind') ?? 'artifact')} ${String(recordValue(artifact, 'model') ?? '')} -> ${String(recordValue(artifact, 'contentPath') ?? recordValue(artifact, 'uri') ?? 'artifact')}`);
			}
		}
	}
	if (outputFormat === 'timeline' || outputFormat === 'tree') {
		return {
			exitCode: 0,
			stdout: [outputFormat === 'tree' ? treeLines.join('\n') : timelineLines.join('\n')],
			report: { action, ok: true, records: forensicRows },
		};
	}
	if (action === 'workday-log' && !outputFormat) {
		const uiExit = await renderWorkdayLogInk({
			title: 'Treeseed Workday Forensics',
			subtitle: `${profile.id} ${teamId} ${workdayId ?? ''}`.trim(),
			records: forensicRows,
			mouseEnabled: boolArg(invocation, 'mouse'),
		});
		if (uiExit !== null) {
			return {
				exitCode: uiExit,
				stdout: [],
				report: {
					action,
					ok: uiExit === 0,
					market: { id: profile.id, baseUrl: profile.baseUrl },
					authMode,
					scope: { teamId, projectId },
					filters: { providerId, status, mode, assignmentId, workdayId, executionProviderId, kind: kindFilter },
					records: forensicRows,
				},
			};
		}
	}
	return guidedResult({
		command: `capacity ${action}`,
		summary: action === 'workday-log'
			? `Read ${forensicRows.length} forensic workday execution record${forensicRows.length === 1 ? '' : 's'} for ${workdayId}.`
			: `Read ${forensicRows.length} execution run audit record${forensicRows.length === 1 ? '' : 's'} for team ${teamId}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Records', value: forensicRows.length },
			...(providerId ? [{ label: 'Provider filter', value: providerId }] : []),
			...(workdayId ? [{ label: 'Workday filter', value: workdayId }] : []),
			...(kindFilter ? [{ label: 'Kind filter', value: kindFilter }] : []),
		],
		sections: [
			{ title: 'Planning Mode', lines: timelineLines.filter((line) => line.includes(' | planning ') || line.includes('| planning |')).slice(0, 50) },
			{ title: 'Acting Mode', lines: timelineLines.filter((line) => line.includes(' | acting ') || line.includes('| acting |')).slice(0, 50) },
			{ title: 'Timeline', lines: timelineLines.slice(0, 25) },
			...(action === 'workday-log' && !outputFormat ? [{ title: 'Interactive UI', lines: ['This terminal is not interactive, so the sidebar TUI could not open here. Re-run from a TTY for the sidebar view; use --mouse only when you also want click and wheel capture.'] }] : []),
			{ title: 'Execution Details', lines: workdayLogDetailLines(forensicRows) },
		],
		report: {
			action,
			market: { id: profile.id, baseUrl: profile.baseUrl },
			authMode,
			scope: { teamId, projectId },
			filters: { providerId, status, mode, assignmentId, workdayId, executionProviderId, kind: kindFilter },
			records: forensicRows,
		},
	});
}

