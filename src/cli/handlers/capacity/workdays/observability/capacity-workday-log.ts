import type { MarketClient } from '@treeseed/sdk/market-client';
import { fetchExecutionRunsForAssignments, fetchProjectModeRunsForAssignment, fetchWorkdayAssignmentIdsForLog } from '../../observability/capacity-forensics.js';
import { redactCapacityOutputSecrets } from '../../capacity-core/capacity-output-security.js';
import { capacityRecordValue as recordValue, formatCapacityNumber as formatNumber, isCapacityRecord as isRecord } from '../../capacity-core/capacity-values.js';
import {
  contextFromWorkPackage, contextPackSummaries, dedupeExecutionRunRecords, firstModeRunBySource,
  lastModeRunBySource, modeRunContentArtifacts, modeRunMetadata, modeRunOutputs, modeRunSource,
  normalizeExecutionRunRecord, uniqueContentArtifacts, workdayRowRecord, workdaySummaryFacts,
} from './capacity-workday-log-records.js';

function compactDuration(value: unknown) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 'n/a';
	if (numeric >= 60_000) return `${formatNumber(numeric / 60_000, 2)}m`;
	if (numeric >= 1000) return `${formatNumber(numeric / 1000, 2)}s`;
	return `${formatNumber(numeric, 0)}ms`;
}

function compactList(value: unknown, limit = 4) {
	if (!Array.isArray(value) || value.length === 0) return 'none';
	const entries = value.map((entry) => String(entry)).filter(Boolean);
	const shown = entries.slice(0, limit).join(', ');
	return entries.length > limit ? `${shown}, +${entries.length - limit} more` : shown;
}

function workdayHumanAssignmentLabel(row: Record<string, unknown>) {
	const facts = workdaySummaryFacts(row);
	const selectedInput = recordValue(workdayRowRecord(row, 'input'), 'selectedInput');
	const cycle = recordValue(selectedInput, 'cycle');
	return [
		String(recordValue(facts.agent, 'agentId') ?? 'agent'),
		cycle ? `cycle ${String(cycle)}` : null,
		String(recordValue(row, 'mode') ?? 'mode'),
	].filter(Boolean).join(' / ');
}

export function workdayTimelineBlock(row: Record<string, unknown>) {
	const facts = workdaySummaryFacts(row);
	const startedAt = String(recordValue(facts.timing, 'startedAt') ?? recordValue(facts.timing, 'createdAt') ?? 'time?');
	const duration = recordValue(facts.timing, 'durationMs');
	const inputTokens = recordValue(facts.tokenCounts, 'inputTokens') ?? recordValue(facts.usage, 'inputTokens');
	const outputTokens = recordValue(facts.tokenCounts, 'outputTokens') ?? recordValue(facts.usage, 'outputTokens');
	const cachedTokens = recordValue(facts.tokenCounts, 'cachedInputTokens') ?? recordValue(facts.usage, 'cachedInputTokens');
	const coreObjectiveIncluded = recordValue(facts.contextDiagnostics, 'coreObjectiveIncluded');
	const treeDxEvidenceCount = recordValue(facts.contextDiagnostics, 'treeDxEvidenceCount');
	const contextPacks = contextPackSummaries(facts.workPackage);
	const treeDxCallCount = facts.treeDxCalls.length;
	return [
		`${startedAt} | ${String(recordValue(row, 'status') ?? 'unknown')} | ${String(recordValue(row, 'mode') ?? 'mode?')} | ${String(recordValue(facts.agent, 'projectSlug') ?? recordValue(facts.agent, 'projectId') ?? 'project?')} | ${String(recordValue(facts.agent, 'agentId') ?? 'agent?')}`,
		`  execution: ${workdayHumanAssignmentLabel(row)} runner=${String(recordValue(facts.assignment, 'runnerId') ?? 'n/a')} duration=${compactDuration(facts.durationMs ?? duration)} telemetry=${facts.modeRuns.length}`,
		`  ai: provider=${String(recordValue(facts.codex, 'provider') ?? recordValue(facts.executionProvider, 'id') ?? 'codex')} model=${String(recordValue(facts.request, 'model') ?? 'n/a')} input=${String(inputTokens ?? 'n/a')} output=${String(outputTokens ?? 'n/a')} cached=${String(cachedTokens ?? 'n/a')} wall=${compactDuration(recordValue(facts.usage, 'wallMs'))}`,
		`  context: coreObjective=${String(coreObjectiveIncluded ?? 'n/a')} evidence=${String(treeDxEvidenceCount ?? contextPacks.length)} packs=${contextPacks.length} treedxCalls=${treeDxCallCount}`,
		`  artifacts: ${facts.artifacts.map((artifact) => `${String(recordValue(artifact, 'artifactKind') ?? 'artifact')} -> ${String(recordValue(artifact, 'contentPath') ?? recordValue(artifact, 'uri') ?? 'path?')}`).join('; ') || 'none'}`,
	];
}

export async function executionRunsForAssignments(client: unknown, teamId: string, assignmentIds: string[]) {
	const rows = await fetchExecutionRunsForAssignments(client as MarketClient, teamId, assignmentIds);
	return dedupeExecutionRunRecords(rows.map((row) => normalizeExecutionRunRecord(redactCapacityOutputSecrets(row) as Record<string, unknown>)));
}

export async function workdayAssignmentIdsForLog(client: unknown, teamId: string, workdayId: string, providerId: string | null) {
	return fetchWorkdayAssignmentIdsForLog(client as MarketClient, teamId, workdayId, providerId);
}

export async function enrichWorkdayLogRecordsWithModeRuns(client: unknown, rows: Record<string, unknown>[]) {
	return Promise.all(rows.map(async (row) => {
		const agent = recordValue(row, 'agent');
		const assignment = recordValue(row, 'assignment');
		const projectId = String(recordValue(agent, 'projectId') ?? '').trim();
		const assignmentId = String(recordValue(assignment, 'id') ?? '').trim();
		if (!projectId || !assignmentId) {
			return { ...row, modeRuns: [] };
		}
		const modeRuns = (await fetchProjectModeRunsForAssignment(client as MarketClient, projectId, assignmentId))
			.map((entry) => redactCapacityOutputSecrets(entry) as Record<string, unknown>)
			.filter(isRecord);
		const modeRunHasContextDiagnostics = (modeRun: Record<string, unknown>) => {
			const outputs = recordValue(modeRun, 'outputs');
			const metadata = recordValue(outputs, 'metadata');
			const workPackage = recordValue(metadata, 'workPackage');
			const workPackageContext = recordValue(workPackage, 'context');
			return Boolean(
				recordValue(workPackageContext, 'contextDiagnostics')
				?? recordValue(workPackage, 'contextDiagnostics')
				?? recordValue(metadata, 'contextDiagnostics'),
			);
		};
		const modeRunHasCoreObjective = (modeRun: Record<string, unknown>) => {
			const outputs = recordValue(modeRun, 'outputs');
			const metadata = recordValue(outputs, 'metadata');
			const workPackage = recordValue(metadata, 'workPackage');
			const workPackageContext = recordValue(workPackage, 'context');
			const diagnostics = recordValue(workPackageContext, 'contextDiagnostics')
				?? recordValue(workPackage, 'contextDiagnostics')
				?? recordValue(metadata, 'contextDiagnostics');
			return recordValue(diagnostics, 'coreObjectiveIncluded') === true || Boolean(recordValue(workPackageContext, 'coreObjective'));
			};
		const contentArtifactRefs = uniqueContentArtifacts([
			...(Array.isArray(recordValue(row, 'contentArtifactRefs')) ? recordValue(row, 'contentArtifactRefs') as unknown[] : []),
			...modeRuns.flatMap((modeRun) => modeRunContentArtifacts(modeRun)),
		]);
		return {
			...row,
			contentArtifactRefs,
			modeRuns,
			forensicCompleteness: {
				modeRuns: modeRuns.length,
				hasExecutionInputSnapshot: modeRuns.some((modeRun) => {
					const outputs = recordValue(modeRun, 'outputs');
					const metadata = recordValue(outputs, 'metadata');
					return Boolean(recordValue(metadata, 'workPackage') ?? recordValue(metadata, 'executionInput') ?? recordValue(modeRun, 'selectedInput'));
				}),
				hasContentArtifactRefs: contentArtifactRefs.length > 0,
				hasContextDiagnostics: modeRuns.some(modeRunHasContextDiagnostics),
				hasCoreObjectiveContext: modeRuns.some(modeRunHasCoreObjective),
			},
		};
	}));
}

export function workdayLogDetailLines(rows: Record<string, unknown>[], maxRecords = 6) {
	const lines: string[] = [];
	for (const row of rows.slice(0, maxRecords)) {
		const facts = workdaySummaryFacts(row);
		const artifacts = facts.artifacts;
		const modeRuns = facts.modeRuns;
		const inputTokens = recordValue(facts.tokenCounts, 'inputTokens') ?? recordValue(facts.usage, 'inputTokens');
		const outputTokens = recordValue(facts.tokenCounts, 'outputTokens') ?? recordValue(facts.usage, 'outputTokens');
		const cachedTokens = recordValue(facts.tokenCounts, 'cachedInputTokens') ?? recordValue(facts.usage, 'cachedInputTokens');
		const contextPacks = contextPackSummaries(facts.workPackage);
		const starting = firstModeRunBySource(modeRuns, 'execution_provider_starting');
		const startMetadata = starting ? modeRunMetadata(starting) : {};
		const startProvider = recordValue(startMetadata, 'provider');
		const startAgent = recordValue(startMetadata, 'agent');
		const workPackageContext = contextFromWorkPackage(facts.workPackage);
		const coreObjective = recordValue(workPackageContext, 'coreObjective');
		const selectedInput = recordValue(row, 'input');
		const selectedInputPayload = recordValue(selectedInput, 'selectedInput');
		const finalResponse = recordValue(facts.codex, 'finalResponse');
		const messages = modeRuns.filter((modeRun) => {
			const metadata = modeRunMetadata(modeRun);
			return modeRunSource(modeRun) === 'agent_kernel_message_emitted' || recordValue(metadata, 'message');
		});
		lines.push(`${String(recordValue(facts.timing, 'startedAt') ?? recordValue(facts.timing, 'createdAt') ?? 'time?')} ${String(recordValue(row, 'status') ?? 'unknown')} ${String(recordValue(row, 'mode') ?? 'mode?')} ${String(recordValue(facts.agent, 'projectSlug') ?? recordValue(facts.agent, 'projectId') ?? 'project?')} ${String(recordValue(facts.agent, 'agentId') ?? 'agent?')}`);
		lines.push(`  Assignment: ${String(recordValue(facts.assignment, 'id') ?? 'n/a')}`);
		lines.push(`    status=${String(recordValue(facts.assignment, 'status') ?? 'n/a')} lease=${String(recordValue(facts.assignment, 'leaseState') ?? 'n/a')} runner=${String(recordValue(facts.assignment, 'runnerId') ?? 'n/a')} workday=${String(recordValue(facts.assignment, 'workdayId') ?? 'n/a')}`);
		lines.push(`    lifecycle=${String(recordValue(facts.assignment, 'lifecycleCode') ?? 'n/a')} duration=${compactDuration(facts.durationMs ?? recordValue(facts.timing, 'durationMs'))}`);
		lines.push(`  Agent: class=${String(recordValue(facts.agent, 'projectAgentClassId') ?? recordValue(facts.agent, 'classSlug') ?? 'n/a')} handler=${String(recordValue(facts.agent, 'handlerId') ?? 'n/a')} configuredProvider=${String(recordValue(startProvider, 'id') ?? recordValue(facts.codex, 'provider') ?? 'codex')}`);
		lines.push(`  AI Model Run: model=${String(recordValue(facts.request, 'model') ?? 'n/a')} reasoning=${String(recordValue(facts.request, 'reasoningEffort') ?? 'n/a')} sandbox=${String(recordValue(facts.request, 'sandboxMode') ?? 'n/a')} approval=${String(recordValue(facts.request, 'approvalPolicy') ?? 'n/a')}`);
		lines.push(`    tokens input=${String(inputTokens ?? 'n/a')} output=${String(outputTokens ?? 'n/a')} cached=${String(cachedTokens ?? 'n/a')} wall=${compactDuration(recordValue(facts.usage, 'wallMs'))} promptChars=${String(recordValue(facts.request, 'promptCharacters') ?? 'n/a')}`);
		lines.push(`  Context: coreObjective=${String(recordValue(facts.contextDiagnostics, 'coreObjectiveIncluded') ?? 'n/a')} path=${String(recordValue(facts.contextDiagnostics, 'coreObjectivePath') ?? recordValue(coreObjective, 'path') ?? 'n/a')} TreeDX=${String(recordValue(facts.contextDiagnostics, 'treeDxAvailable') ?? 'n/a')} evidence=${String(recordValue(facts.contextDiagnostics, 'treeDxEvidenceCount') ?? contextPacks.length)}`);
		for (const pack of contextPacks.slice(0, 8)) {
			lines.push(`    context pack: ${pack.id} source=${pack.source} tokens=${String(pack.tokens ?? 'n/a')} truncated=${String(pack.truncated ?? 'n/a')} paths=${compactList(pack.paths)}`);
		}
		if (facts.treeDxCalls.length === 0) {
			lines.push('    TreeDX proxy calls: none recorded');
		} else {
			lines.push(`    TreeDX proxy calls: ${facts.treeDxCalls.length}`);
			for (const call of facts.treeDxCalls.slice(0, 10)) {
				lines.push(`      ${call.operation} ${call.path} status=${String(call.status ?? 'n/a')} duration=${compactDuration(call.durationMs)} target=${Array.isArray(call.target) ? compactList(call.target) : String(call.target ?? 'n/a')}`);
			}
		}
		if (isRecord(selectedInputPayload)) {
			lines.push(`  Input: objective=${String(recordValue(selectedInputPayload, 'objective') ?? 'n/a')}`);
			lines.push(`    artifactKind=${String(recordValue(selectedInputPayload, 'artifactKind') ?? 'n/a')} subject=${String(recordValue(selectedInputPayload, 'subjectModel') ?? 'n/a')}:${String(recordValue(selectedInputPayload, 'subjectId') ?? 'n/a')} subjectPath=${String(recordValue(selectedInputPayload, 'subjectPath') ?? 'n/a')}`);
		}
		if (isRecord(startAgent)) {
			lines.push(`  Agent Config Snapshot: capabilities=${compactList(recordValue(startAgent, 'capabilities'))} outputTypes=${compactList(recordValue(startAgent, 'outputTypes'))}`);
		}
		if (artifacts.length === 0) {
			lines.push('  artifacts: none');
		} else {
			lines.push('  Artifacts Written:');
			for (const artifact of artifacts.slice(0, 8)) {
				lines.push(`    ${String(recordValue(artifact, 'artifactKind') ?? 'artifact')} ${String(recordValue(artifact, 'model') ?? 'model?')} -> ${String(recordValue(artifact, 'contentPath') ?? recordValue(artifact, 'uri') ?? 'path?')}`);
			}
		}
		if (messages.length === 0) {
			lines.push('  Messages/Signals: none recorded');
		} else {
			lines.push(`  Messages/Signals: ${messages.length}`);
			for (const messageRun of messages.slice(0, 8)) {
				const message = recordValue(modeRunMetadata(messageRun), 'message');
				const messageType = String((recordValue(message, 'type') ?? modeRunSource(messageRun)) || 'message');
				lines.push(`    ${String(recordValue(messageRun, 'createdAt') ?? 'time?')} ${messageType} ${String(recordValue(message, 'status') ?? '')}`.trimEnd());
			}
		}
		lines.push(`  Execution Timeline: ${modeRuns.length} telemetry event(s)`);
		for (const modeRun of modeRuns.slice(0, 18)) {
			const outputs = modeRunOutputs(modeRun);
			lines.push(`    ${String(recordValue(modeRun, 'createdAt') ?? 'time?')} ${String(recordValue(modeRun, 'status') ?? 'n/a')} ${modeRunSource(modeRun) || 'mode-run'}: ${String(recordValue(outputs, 'summary') ?? '').replace(/\s+/gu, ' ').slice(0, 220)}`);
		}
		const adapter = lastModeRunBySource(modeRuns, 'execution_provider_adapter_lifecycle');
		if (adapter) {
			const outputs = modeRunOutputs(adapter);
			lines.push(`  Final AI Response: ${String(finalResponse ?? recordValue(outputs, 'summary') ?? 'n/a').replace(/\s+/gu, ' ').slice(0, 500)}`);
		}
		lines.push('');
	}
	if (rows.length > maxRecords) {
		lines.push(`... ${rows.length - maxRecords} more execution records omitted from text detail. Use --mouse, --json, or --format yaml for the complete forensic record.`);
	}
	return lines.length > 0 ? lines : ['No execution records returned.'];
}

