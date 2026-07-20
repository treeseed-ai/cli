import { capacityRecordValue as recordValue, isCapacityRecord as isRecord } from './capacity-values.js';

export function modeRunContentArtifacts(modeRun: unknown) {
	if (!modeRun || typeof modeRun !== 'object') return [];
	const directRefs = recordValue(modeRun, 'contentArtifactRefs');
	if (Array.isArray(directRefs)) return uniqueContentArtifacts(directRefs);
	const outputs = recordValue(recordValue(modeRun, 'output'), 'outputs') ?? recordValue(modeRun, 'outputs');
	const outputRefs = recordValue(recordValue(outputs, 'metadata'), 'contentArtifactRefs');
	if (Array.isArray(outputRefs)) return uniqueContentArtifacts(outputRefs);
	const lifecycleOutput = recordValue(recordValue(modeRun, 'output'), 'lifecycleOutput') ?? recordValue(modeRun, 'lifecycleOutput');
	const lifecycleRefs = recordValue(recordValue(lifecycleOutput, 'metadata'), 'contentArtifactRefs');
	return Array.isArray(lifecycleRefs) ? uniqueContentArtifacts(lifecycleRefs) : [];
}

export function assignmentContentArtifacts(assignment: unknown) {
	const output = recordValue(assignment, 'lifecycleOutput');
	const refs = recordValue(recordValue(output, 'metadata'), 'contentArtifactRefs');
	return Array.isArray(refs) ? uniqueContentArtifacts(refs) : [];
}

function contentArtifactKey(artifact: unknown) {
	const record = artifact && typeof artifact === 'object' && !Array.isArray(artifact) ? artifact as Record<string, unknown> : {};
	return [
		record.contentPath ?? record.path ?? record.uri ?? '',
		record.artifactKind ?? record.kind ?? '',
		record.sourceAssignmentId ?? '',
		record.producedByAgent ?? '',
		record.executionProviderRunId ?? '',
	].map((part) => String(part ?? '')).join('\u0000');
}

export function uniqueContentArtifacts(artifacts: unknown[]) {
	const seen = new Set<string>();
	const result: unknown[] = [];
	for (const artifact of artifacts) {
		const key = contentArtifactKey(artifact);
		if (!key.trim() || seen.has(key)) continue;
		seen.add(key);
		result.push(artifact);
	}
	return result;
}

export function normalizeExecutionRunRecord(row: Record<string, unknown>) {
	const contentArtifactRefs = recordValue(row, 'contentArtifactRefs');
	return {
		...row,
		...(Array.isArray(contentArtifactRefs) ? { contentArtifactRefs: uniqueContentArtifacts(contentArtifactRefs) } : {}),
	};
}

function executionRunProjectionKey(row: Record<string, unknown>) {
	const assignment = recordValue(row, 'assignment');
	const assignmentId = String(recordValue(assignment, 'id') ?? '').trim();
	const artifacts = Array.isArray(recordValue(row, 'contentArtifactRefs')) ? recordValue(row, 'contentArtifactRefs') as unknown[] : [];
	const artifactRunId = artifacts
		.map((artifact) => String(recordValue(artifact, 'executionProviderRunId') ?? '').trim())
		.find(Boolean);
	const executionProvider = recordValue(row, 'executionProvider');
	const providerRunId = String(recordValue(executionProvider, 'id') ?? '').trim();
	const runId = artifactRunId ?? providerRunId ?? String(recordValue(row, 'id') ?? '').trim();
	return `${assignmentId || 'assignment'}:${runId || String(recordValue(row, 'id') ?? 'run')}`;
}

function executionRunProjectionRank(row: Record<string, unknown>) {
	const status = String(recordValue(row, 'status') ?? '').toLowerCase();
	const timing = recordValue(row, 'timing');
	const executionProvider = recordValue(row, 'executionProvider');
	const hasTokenCounts = recordValue(executionProvider, 'hasTokenCounts') === true;
	const completed = Boolean(recordValue(timing, 'completedAt'));
	const failed = Boolean(recordValue(timing, 'failedAt'));
	const terminal = ['succeeded', 'completed', 'failed', 'cancelled'].includes(status) || completed || failed;
	return [
		terminal ? 100 : 0,
		hasTokenCounts ? 50 : 0,
		status === 'succeeded' || status === 'completed' ? 20 : 0,
		Number(new Date(String(recordValue(timing, 'createdAt') ?? 0)).getTime()) / 1_000_000_000,
	].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

export function dedupeExecutionRunRecords(rows: Record<string, unknown>[]) {
	const byKey = new Map<string, Record<string, unknown>>();
	for (const row of rows) {
		const key = executionRunProjectionKey(row);
		const current = byKey.get(key);
		if (!current || executionRunProjectionRank(row) >= executionRunProjectionRank(current)) {
			byKey.set(key, row);
		}
	}
	return [...byKey.values()].sort((a, b) => {
		const aTiming = recordValue(a, 'timing');
		const bTiming = recordValue(b, 'timing');
		const aTime = Number(new Date(String(recordValue(aTiming, 'createdAt') ?? 0)).getTime());
		const bTime = Number(new Date(String(recordValue(bTiming, 'createdAt') ?? 0)).getTime());
		return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
	});
}

function workdayExecutionKey(row: Record<string, unknown>) {
	const assignment = recordValue(row, 'assignment');
	const assignmentId = String(recordValue(assignment, 'id') ?? '').trim();
	if (assignmentId) return assignmentId;
	const agent = recordValue(row, 'agent');
	return [
		recordValue(agent, 'projectId') ?? 'project',
		recordValue(agent, 'agentId') ?? 'agent',
		recordValue(row, 'mode') ?? 'mode',
		recordValue(row, 'id') ?? 'run',
	].map((part) => String(part ?? '')).join(':');
}

export function groupWorkdayExecutionRecords(rows: Record<string, unknown>[]) {
	const byAssignment = new Map<string, Record<string, unknown>>();
	for (const row of rows) {
		const key = workdayExecutionKey(row);
		const current = byAssignment.get(key);
		if (!current || executionRunProjectionRank(row) >= executionRunProjectionRank(current)) {
			byAssignment.set(key, row);
		}
	}
	return [...byAssignment.values()].sort((a, b) => {
		const aTiming = recordValue(a, 'timing');
		const bTiming = recordValue(b, 'timing');
		const aTime = timestampMs(recordValue(aTiming, 'startedAt') ?? recordValue(aTiming, 'createdAt')) ?? 0;
		const bTime = timestampMs(recordValue(bTiming, 'startedAt') ?? recordValue(bTiming, 'createdAt')) ?? 0;
		return aTime - bTime;
	});
}

function modeRunProjectionKey(row: Record<string, unknown>) {
	const assignmentId = String(recordValue(row, 'providerAssignmentId') ?? recordValue(recordValue(row, 'selectedInput'), 'assignmentId') ?? '').trim();
	const mode = String(recordValue(row, 'mode') ?? '').trim();
	const agentId = String(recordValue(row, 'agentId') ?? '').trim();
	const handlerId = String(recordValue(row, 'handlerId') ?? '').trim();
	return [assignmentId || String(recordValue(row, 'id') ?? 'assignment'), mode || 'mode', agentId || 'agent', handlerId || 'handler'].join(':');
}

function modeRunProjectionRank(row: Record<string, unknown>) {
	const status = String(recordValue(row, 'status') ?? '').toLowerCase();
	const outputs = recordValue(row, 'outputs');
	const metadata = recordValue(outputs, 'metadata');
	const hasArtifacts = Array.isArray(recordValue(metadata, 'contentArtifactRefs'))
		&& (recordValue(metadata, 'contentArtifactRefs') as unknown[]).length > 0;
	const timing = recordValue(row, 'timing');
	return [
		['succeeded', 'completed', 'failed', 'cancelled'].includes(status) ? 100 : 0,
		hasArtifacts ? 50 : 0,
		status === 'succeeded' || status === 'completed' ? 20 : 0,
		Number(new Date(String(recordValue(timing, 'createdAt') ?? recordValue(row, 'createdAt') ?? 0)).getTime()) / 1_000_000_000,
	].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

export function dedupeModeRunRecords(rows: unknown[]) {
	const byKey = new Map<string, Record<string, unknown>>();
	for (const row of rows.filter(isRecord)) {
		const key = modeRunProjectionKey(row);
		const current = byKey.get(key);
		if (!current || modeRunProjectionRank(row) >= modeRunProjectionRank(current)) {
			byKey.set(key, row);
		}
	}
	return [...byKey.values()];
}

export function workdayRowRecord(row: Record<string, unknown>, key: string) {
	const value = recordValue(row, key);
	return isRecord(value) ? value : {};
}

export function modeRunOutputs(modeRun: Record<string, unknown>) {
	const outputs = recordValue(modeRun, 'outputs');
	return isRecord(outputs) ? outputs : {};
}

export function modeRunMetadata(modeRun: Record<string, unknown>) {
	const metadata = recordValue(modeRunOutputs(modeRun), 'metadata');
	return isRecord(metadata) ? metadata : {};
}

export function modeRunSource(modeRun: Record<string, unknown>) {
	return String(recordValue(modeRun, 'source') ?? recordValue(modeRunMetadata(modeRun), 'source') ?? '').trim();
}

export function firstModeRunBySource(modeRuns: Record<string, unknown>[], source: string) {
	return modeRuns.find((modeRun) => modeRunSource(modeRun) === source);
}

export function lastModeRunBySource(modeRuns: Record<string, unknown>[], source: string) {
	return [...modeRuns].reverse().find((modeRun) => modeRunSource(modeRun) === source);
}

function codexSnapshotFromModeRuns(modeRuns: Record<string, unknown>[]) {
	for (const modeRun of [...modeRuns].reverse()) {
		const metadata = modeRunMetadata(modeRun);
		const codex = recordValue(metadata, 'codex');
		if (isRecord(codex)) return codex;
		const result = recordValue(metadata, 'result');
		const snapshot = recordValue(recordValue(result, 'snapshot'), 'metadata');
		const snapshotCodex = recordValue(snapshot, 'codex');
		if (isRecord(snapshotCodex)) return snapshotCodex;
		const directSnapshot = recordValue(recordValue(metadata, 'snapshot'), 'metadata');
		const directSnapshotCodex = recordValue(directSnapshot, 'codex');
		if (isRecord(directSnapshotCodex)) return directSnapshotCodex;
	}
	return {};
}

function workPackageFromModeRuns(modeRuns: Record<string, unknown>[]) {
	const scored = modeRuns
		.map((modeRun) => {
			const metadata = modeRunMetadata(modeRun);
			const workPackage = recordValue(metadata, 'workPackage');
			const resolved = recordValue(metadata, 'resolvedInputs');
			const packageFromResolved = recordValue(resolved, 'workPackage');
			const candidate = isRecord(workPackage) ? workPackage : isRecord(packageFromResolved) ? packageFromResolved : {};
			const context = recordValue(candidate, 'context');
			const evidence = Array.isArray(recordValue(context, 'treeDxEvidence')) ? recordValue(context, 'treeDxEvidence') as unknown[] : [];
			const score = evidence.length * 10
				+ (recordValue(context, 'coreObjective') ? 5 : 0)
				+ (recordValue(candidate, 'instructions') ? 3 : 0)
				+ (recordValue(candidate, 'expectedOutputs') ? 1 : 0);
			return { candidate, score };
		})
		.filter((entry) => Object.keys(entry.candidate).length > 0)
		.sort((a, b) => b.score - a.score);
	return scored[0]?.candidate ?? {};
}

export function contextFromWorkPackage(workPackage: Record<string, unknown>) {
	const context = recordValue(workPackage, 'context');
	return isRecord(context) ? context : {};
}

function contextDiagnosticsFromWorkPackage(workPackage: Record<string, unknown>) {
	const context = contextFromWorkPackage(workPackage);
	const diagnostics = recordValue(context, 'contextDiagnostics') ?? recordValue(workPackage, 'contextDiagnostics');
	return isRecord(diagnostics) ? diagnostics : {};
}

export function contextPackSummaries(workPackage: Record<string, unknown>) {
	const context = contextFromWorkPackage(workPackage);
	const packs = Array.isArray(recordValue(context, 'contextPacks')) ? recordValue(context, 'contextPacks') as unknown[] : [];
	return packs.filter(isRecord).map((pack) => {
		const packValue = recordValue(pack, 'pack');
		const diagnostics = isRecord(packValue) ? recordValue(packValue, 'diagnostics') : undefined;
		const budget = recordValue(diagnostics, 'budget');
		return {
			id: String(recordValue(pack, 'id') ?? 'context'),
			source: String(recordValue(pack, 'source') ?? 'n/a'),
			purpose: String(recordValue(pack, 'purpose') ?? 'n/a'),
			paths: recordValue(recordValue(pack, 'sourceRef'), 'paths') ?? recordValue(recordValue(pack, 'sourceRef'), 'path'),
			tokens: recordValue(packValue, 'totalTokenEstimate') ?? recordValue(budget, 'estimatedTokens'),
			truncated: recordValue(budget, 'truncated'),
			provenancePaths: recordValue(diagnostics, 'provenancePaths'),
		};
	});
}

function treeDxProxyCallSummaries(modeRuns: Record<string, unknown>[]) {
	const completed = modeRuns.filter((modeRun) => {
		const metadata = modeRunMetadata(modeRun);
		return modeRunSource(modeRun) === 'provider_runner_treedx_proxy_request'
			&& String(recordValue(metadata, 'phase') ?? '') !== 'started';
	});
	return completed.map((modeRun) => {
		const metadata = modeRunMetadata(modeRun);
		const preview = recordValue(metadata, 'bodyPreview');
		return {
			operation: String(recordValue(metadata, 'operation') ?? 'request'),
			path: String(recordValue(metadata, 'path') ?? 'n/a'),
			status: recordValue(metadata, 'httpStatus'),
			durationMs: recordValue(metadata, 'durationMs'),
			resultCount: recordValue(metadata, 'resultCount'),
			target: recordValue(preview, 'path') ?? recordValue(preview, 'query') ?? recordValue(preview, 'paths'),
		};
	});
}

function telemetrySpanMs(modeRuns: Record<string, unknown>[]) {
	const times = modeRuns
		.flatMap((modeRun) => [
			timestampMs(recordValue(modeRun, 'startedAt')),
			timestampMs(recordValue(modeRun, 'createdAt')),
			timestampMs(recordValue(modeRun, 'completedAt')),
			timestampMs(recordValue(modeRun, 'updatedAt')),
			timestampMs(recordValue(modeRun, 'failedAt')),
		])
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	if (times.length < 2) return null;
	return Math.max(...times) - Math.min(...times);
}

export function workdaySummaryFacts(row: Record<string, unknown>) {
	const timing = workdayRowRecord(row, 'timing');
	const agent = workdayRowRecord(row, 'agent');
	const assignment = workdayRowRecord(row, 'assignment');
	const executionProvider = workdayRowRecord(row, 'executionProvider');
	const modeRuns = Array.isArray(recordValue(row, 'modeRuns')) ? recordValue(row, 'modeRuns') as Record<string, unknown>[] : [];
	const workPackage = workPackageFromModeRuns(modeRuns);
	const contextDiagnostics = contextDiagnosticsFromWorkPackage(workPackage);
	const codex = codexSnapshotFromModeRuns(modeRuns);
	const codexMetadata = recordValue(codex, 'metadata');
	const request = recordValue(codexMetadata, 'request');
	const usage = recordValue(codex, 'usage');
	const tokenCounts = recordValue(executionProvider, 'tokenCounts');
	const artifacts = uniqueContentArtifacts(Array.isArray(recordValue(row, 'contentArtifactRefs')) ? recordValue(row, 'contentArtifactRefs') as unknown[] : []);
	const treeDxCalls = treeDxProxyCallSummaries(modeRuns);
	const directDuration = Number(recordValue(timing, 'durationMs'));
	const usageDuration = Number(recordValue(isRecord(usage) ? usage : {}, 'wallMs'));
	const durationMsValue = Number.isFinite(directDuration) && directDuration > 0
		? directDuration
		: telemetrySpanMs(modeRuns) ?? (Number.isFinite(usageDuration) && usageDuration > 0 ? usageDuration : null);
	return {
		timing,
		agent,
		assignment,
		executionProvider,
		modeRuns,
		workPackage,
		contextDiagnostics,
		codex,
		request: isRecord(request) ? request : {},
		usage: isRecord(usage) ? usage : {},
		tokenCounts: isRecord(tokenCounts) ? tokenCounts : {},
		artifacts,
		treeDxCalls,
		durationMs: durationMsValue,
	};
}
