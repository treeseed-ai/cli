import { Box, render, Text, useApp, useInput, useWindowSize } from 'ink';
import React from 'react';
import {
	AppFrame,
	clampOffset,
	computeViewportLayout,
	ensureVisible,
	findClickableRegion,
	routeWheelDeltaToScrollRegion,
	scrollOffsetByDelta,
	scrollOffsetByPage,
	SidebarList,
	StatusBar,
	truncateLine,
	type ScrollRegionState,
	type UiClickRegion,
	type UiRect,
	type UiScrollRegion,
	wrapText,
} from './ui/framework.js';
import { useTerminalMouse } from './ui/mouse.js';

type WorkdayLogLayout = ReturnType<typeof computeWorkdayLogLayout>;
type WorkdayLogFocusArea = 'planning' | 'acting' | 'detail';
type WorkdayLogSection = 'planning' | 'acting';

type DetailRow = {
	text: string;
	color?: 'cyan' | 'gray' | 'white' | 'yellow' | 'green' | 'magenta' | 'red' | 'blue' | 'black';
	bold?: boolean;
};

type WorkdayLogViewRecord = Record<string, unknown>;

export type WorkdayLogUiInput = {
	title: string;
	subtitle: string;
	records: WorkdayLogViewRecord[];
	mouseEnabled?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function valueAt(record: Record<string, unknown> | undefined, key: string) {
	return record ? record[key] : undefined;
}

function stringValue(value: unknown, fallback = 'n/a') {
	if (value === null || value === undefined || value === '') return fallback;
	return String(value);
}

function numberValue(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return null;
}

function formatDuration(ms: unknown) {
	const value = numberValue(ms);
	if (value === null) return 'n/a';
	if (value < 1000) return `${Math.round(value)}ms`;
	if (value >= 60_000) return `${(value / 60_000).toFixed(2)}m`;
	return `${(value / 1000).toFixed(2)}s`;
}

function artifactCount(record: WorkdayLogViewRecord) {
	const artifacts = valueAt(record, 'contentArtifactRefs');
	return Array.isArray(artifacts) ? artifacts.length : 0;
}

function modeOf(record: WorkdayLogViewRecord) {
	return stringValue(valueAt(record, 'mode'), 'unknown').toLowerCase();
}

function agentRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'agent');
	return isRecord(value) ? value : {};
}

function assignmentRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'assignment');
	return isRecord(value) ? value : {};
}

function timingRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'timing');
	return isRecord(value) ? value : {};
}

function executionProviderRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'executionProvider');
	return isRecord(value) ? value : {};
}

function modeRunRecords(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'modeRuns');
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordLabel(record: WorkdayLogViewRecord) {
	const agent = agentRecord(record);
	const timing = timingRecord(record);
	const startedAt = stringValue(valueAt(timing, 'startedAt') ?? valueAt(timing, 'createdAt'), 'time?');
	const time = startedAt.includes('T') ? startedAt.slice(11, 19) : startedAt;
	const artifacts = artifactCount(record);
	return `${time} ${stringValue(valueAt(agent, 'agentId'), 'agent?')}${artifacts ? ` (${artifacts})` : ''}`;
}

function recordTone(record: WorkdayLogViewRecord): 'required' | 'normal' {
	const status = stringValue(valueAt(record, 'status'), '').toLowerCase();
	return status === 'failed' || status === 'blocked' ? 'required' : 'normal';
}

function computeWorkdayLogLayout(rows: number, columns: number) {
	const layout = computeViewportLayout(rows, columns, { topBarHeight: 3, footerHeight: 2 });
	const sidebarWidth = Math.max(28, Math.min(44, Math.floor(layout.columns * 0.34)));
	const detailWidth = Math.max(42, layout.columns - sidebarWidth - 1);
	const planningHeight = Math.max(5, Math.floor(layout.bodyHeight * 0.5));
	const actingHeight = Math.max(5, layout.bodyHeight - planningHeight);
	return {
		...layout,
		sidebarWidth,
		detailWidth,
		planningHeight,
		actingHeight,
	};
}

function detailViewport(rows: DetailRow[], height: number, offset: number) {
	const viewportSize = Math.max(1, height - 3);
	const safeOffset = clampOffset(offset, rows.length, viewportSize);
	return {
		rows: rows.slice(safeOffset, safeOffset + viewportSize),
		offset: safeOffset,
		viewportSize,
		totalSize: rows.length,
	};
}

function addWrapped(rows: DetailRow[], text: string, width: number, style: Omit<DetailRow, 'text'> = {}) {
	for (const line of wrapText(text, width)) {
		rows.push({ text: line, ...style });
	}
}

function addSection(rows: DetailRow[], title: string) {
	if (rows.length && rows.at(-1)?.text !== '') rows.push({ text: '' });
	rows.push({ text: title, color: 'yellow', bold: true });
}

function addField(rows: DetailRow[], label: string, value: unknown, width: number, color: DetailRow['color'] = 'white') {
	addWrapped(rows, `${label}: ${stringValue(value)}`, width, { color });
}

function addTextBlock(rows: DetailRow[], title: string, value: unknown, width: number, color: DetailRow['color'] = 'white') {
	if (value === undefined || value === null || value === '') return;
	rows.push({ text: title, color: 'cyan', bold: true });
	for (const line of String(value).split('\n')) {
		addWrapped(rows, line.trimEnd() || ' ', width, { color });
	}
}

function compactDurationForRecord(record: WorkdayLogViewRecord) {
	const timing = timingRecord(record);
	const direct = numberValue(valueAt(timing, 'durationMs'));
	if (direct && direct > 0) return formatDuration(direct);
	const modeRuns = modeRunRecords(record);
	const times = modeRuns
		.flatMap((modeRun) => [
			valueAt(modeRun, 'startedAt'),
			valueAt(modeRun, 'createdAt'),
			valueAt(modeRun, 'completedAt'),
			valueAt(modeRun, 'updatedAt'),
		])
		.map((value) => typeof value === 'string' ? Date.parse(value) : Number.NaN)
		.filter((value) => Number.isFinite(value));
	if (times.length >= 2) return formatDuration(Math.max(...times) - Math.min(...times));
	const codex = codexRunRecord(record);
	const usage = isRecord(valueAt(codex, 'usage')) ? valueAt(codex, 'usage') as Record<string, unknown> : {};
	return formatDuration(valueAt(usage, 'wallMs'));
}

function selectedInputRecord(record: WorkdayLogViewRecord) {
	return recordFromPath(record, ['input', 'selectedInput']);
}

function cycleLabel(record: WorkdayLogViewRecord) {
	const input = selectedInputRecord(record);
	const cycle = valueAt(input, 'cycle');
	return cycle === undefined || cycle === null ? 'cycle n/a' : `cycle ${String(cycle)}`;
}

function subjectLabel(record: WorkdayLogViewRecord) {
	const input = selectedInputRecord(record);
	return `${stringValue(valueAt(input, 'subjectModel'))}:${stringValue(valueAt(input, 'subjectId'))}`;
}

function artifactKindLabel(record: WorkdayLogViewRecord) {
	const input = selectedInputRecord(record);
	const artifacts = uniqueArtifactsForRecord(record);
	return stringValue(valueAt(input, 'artifactKind') ?? valueAt(artifacts[0], 'artifactKind'), 'n/a');
}

function tokenUsage(record: WorkdayLogViewRecord) {
	const provider = executionProviderRecord(record);
	const tokenCounts = isRecord(valueAt(provider, 'tokenCounts')) ? valueAt(provider, 'tokenCounts') as Record<string, unknown> : {};
	const codex = codexRunRecord(record);
	const usage = isRecord(valueAt(codex, 'usage')) ? valueAt(codex, 'usage') as Record<string, unknown> : {};
	return {
		input: valueAt(tokenCounts, 'inputTokens') ?? valueAt(usage, 'inputTokens'),
		output: valueAt(tokenCounts, 'outputTokens') ?? valueAt(usage, 'outputTokens'),
		cached: valueAt(tokenCounts, 'cachedInputTokens') ?? valueAt(usage, 'cachedInputTokens'),
		wallMs: valueAt(usage, 'wallMs'),
	};
}

function firstRecord(...values: unknown[]) {
	return values.find(isRecord) as Record<string, unknown> | undefined;
}

function recordFromPath(root: unknown, path: string[]) {
	let current: unknown = root;
	for (const key of path) {
		if (!isRecord(current)) return {};
		current = current[key];
	}
	return isRecord(current) ? current : {};
}

function arrayFromPath(root: unknown, path: string[]) {
	let current: unknown = root;
	for (const key of path) {
		if (!isRecord(current)) return [];
	current = current[key];
	}
	return Array.isArray(current) ? current : [];
}

function recordsFrom(value: unknown) {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function collectWorkPackages(record: WorkdayLogViewRecord) {
	const packages: Record<string, unknown>[] = [];
	const output = isRecord(valueAt(record, 'output')) ? valueAt(record, 'output') as Record<string, unknown> : {};
	const directOutputs = isRecord(valueAt(output, 'outputs')) ? valueAt(output, 'outputs') as Record<string, unknown> : {};
	const directMetadata = isRecord(valueAt(directOutputs, 'metadata')) ? valueAt(directOutputs, 'metadata') as Record<string, unknown> : {};
	const directWorkPackage = valueAt(directMetadata, 'workPackage');
	if (isRecord(directWorkPackage)) packages.push(directWorkPackage);
	for (const modeRun of modeRunRecords(record)) {
		const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
		const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
		const workPackage = valueAt(metadata, 'workPackage');
		if (isRecord(workPackage)) packages.push(workPackage);
	}
	return packages;
}

function workPackageForensicScore(workPackage: Record<string, unknown>) {
	const context = contextRecordFromWorkPackage(workPackage);
	const evidence = treeDxEvidenceRecords(workPackage);
	const diagnostics = valueAt(context, 'contextDiagnostics') ?? valueAt(workPackage, 'contextDiagnostics');
	return [
		evidence.length * 100,
		isRecord(valueAt(context, 'coreObjective')) ? 40 : 0,
		isRecord(diagnostics) ? 30 : 0,
		valueAt(workPackage, 'instructions') ? 20 : 0,
		recordsFrom(valueAt(workPackage, 'expectedOutputs')).length * 5,
	].reduce((sum, value) => sum + value, 0);
}

function selectPrimaryWorkPackage(workPackages: Record<string, unknown>[]) {
	return [...workPackages].sort((left, right) => workPackageForensicScore(right) - workPackageForensicScore(left))[0] ?? {};
}

function codexRunRecord(record: WorkdayLogViewRecord) {
	const output = isRecord(valueAt(record, 'output')) ? valueAt(record, 'output') as Record<string, unknown> : {};
	const directOutputs = isRecord(valueAt(output, 'outputs')) ? valueAt(output, 'outputs') as Record<string, unknown> : {};
	const directMetadata = isRecord(valueAt(directOutputs, 'metadata')) ? valueAt(directOutputs, 'metadata') as Record<string, unknown> : {};
	const directCodex = valueAt(directMetadata, 'codex');
	if (isRecord(directCodex)) return directCodex;
	const directSnapshotCodex = recordFromPath(directMetadata, ['executionSnapshot', 'metadata', 'codex']);
	if (Object.keys(directSnapshotCodex).length) return directSnapshotCodex;
	for (const modeRun of modeRunRecords(record)) {
		const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
		const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
		const codex = valueAt(metadata, 'codex');
		if (isRecord(codex)) return codex;
		const result = recordFromPath(metadata, ['result']);
		const snapshotCodex = recordFromPath(result, ['snapshot', 'metadata', 'codex']);
		if (Object.keys(snapshotCodex).length) return snapshotCodex;
		const directSnapshotCodex = recordFromPath(metadata, ['snapshot', 'metadata', 'codex']);
		if (Object.keys(directSnapshotCodex).length) return directSnapshotCodex;
	}
	return {};
}

function contextRecordFromWorkPackage(workPackage: Record<string, unknown>) {
	return isRecord(valueAt(workPackage, 'context')) ? valueAt(workPackage, 'context') as Record<string, unknown> : {};
}

function treeDxEvidenceRecords(workPackage: Record<string, unknown>) {
	return arrayFromPath(workPackage, ['context', 'treeDxEvidence']).filter(isRecord);
}

function renderValuePreview(value: unknown, width: number) {
	if (value === undefined || value === null) return 'n/a';
	if (typeof value === 'string') return truncateLine(value.replace(/\s+/gu, ' ').trim(), width);
	if (Array.isArray(value)) return `${value.length} item(s)`;
	if (isRecord(value)) {
		const keys = Object.keys(value);
		return truncateLine(keys.length ? keys.slice(0, 8).join(', ') : '{}', width);
	}
	return String(value);
}

function compactScalar(value: unknown) {
	if (typeof value === 'string') return value.replace(/\s+/gu, ' ').trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null || value === undefined) return 'n/a';
	return renderValuePreview(value, 120);
}

function readableList(values: unknown, fallback = 'none') {
	if (!Array.isArray(values) || values.length === 0) return fallback;
	return values.map((entry) => compactScalar(entry)).filter(Boolean).join(', ') || fallback;
}

function addBullet(rows: DetailRow[], text: string, width: number, color: DetailRow['color'] = 'white') {
	addWrapped(rows, `- ${text}`, width, { color });
}

function addFieldIfPresent(rows: DetailRow[], label: string, value: unknown, width: number, color: DetailRow['color'] = 'white') {
	if (value === undefined || value === null || value === '') return;
	addField(rows, label, value, width, color);
}

function addCompactKV(rows: DetailRow[], label: string, values: Array<[string, unknown]>, width: number) {
	const rendered = values
		.filter(([, value]) => value !== undefined && value !== null && value !== '')
		.map(([key, value]) => `${key}=${compactScalar(value)}`)
		.join('  ');
	addField(rows, label, rendered || 'n/a', width, 'gray');
}

function addRecordFields(rows: DetailRow[], title: string, value: unknown, width: number, color: DetailRow['color'] = 'gray') {
	if (!isRecord(value) || Object.keys(value).length === 0) return;
	rows.push({ text: title, color: 'cyan', bold: true });
	for (const [key, entry] of Object.entries(value)) {
		addWrapped(rows, `${key}: ${compactScalar(entry)}`, width, { color });
	}
}

function addStructuredValue(rows: DetailRow[], title: string, value: unknown, width: number, color: DetailRow['color'] = 'gray', maxLines = 18) {
	if (value === undefined || value === null || value === '') return;
	rows.push({ text: title, color: 'cyan', bold: true });
	if (isRecord(value)) {
		for (const [key, entry] of Object.entries(value).slice(0, maxLines)) {
			addWrapped(rows, `${key}: ${compactScalar(entry)}`, width, { color });
		}
		const extra = Object.keys(value).length - maxLines;
		if (extra > 0) addWrapped(rows, `... ${extra} more field(s); use --format yaml for the complete value.`, width, { color: 'gray' });
		return;
	}
	const lines = JSON.stringify(value, null, 2)?.split('\n') ?? [String(value)];
	for (const line of lines.slice(0, maxLines)) {
		addWrapped(rows, line, width, { color });
	}
	if (lines.length > maxLines) addWrapped(rows, `... ${lines.length - maxLines} more line(s); use --format yaml for the complete value.`, width, { color: 'gray' });
}

function sourceForModeRun(modeRun: Record<string, unknown>) {
	const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
	const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
	return stringValue(valueAt(modeRun, 'source') ?? valueAt(metadata, 'source'), '');
}

function metadataForModeRun(modeRun: Record<string, unknown>) {
	const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
	const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
	return {
		outputs,
		metadata,
	};
}

function treeDxProxyModeRuns(record: WorkdayLogViewRecord) {
	return modeRunRecords(record).filter((modeRun) => sourceForModeRun(modeRun) === 'provider_runner_treedx_proxy_request');
}

function proxyRequestLabel(metadata: Record<string, unknown>) {
	const preview = isRecord(valueAt(metadata, 'bodyPreview')) ? valueAt(metadata, 'bodyPreview') as Record<string, unknown> : {};
	const target = stringValue(valueAt(preview, 'path') ?? valueAt(preview, 'query') ?? readableList(valueAt(preview, 'paths')), '');
	const operation = stringValue(valueAt(metadata, 'operation'), 'request');
	return target ? `${operation} ${target}` : operation;
}

function addTreeDxProxyCalls(rows: DetailRow[], record: WorkdayLogViewRecord, width: number) {
	const calls = treeDxProxyModeRuns(record);
	if (!calls.length) {
		rows.push({ text: 'No TreeDX proxy call telemetry was captured for this execution.', color: 'red' });
		return;
	}
	const byOperation = new Map<string, { started?: Record<string, unknown>; completed?: Record<string, unknown>; failed?: Record<string, unknown> }>();
	for (const call of calls) {
		const { metadata } = metadataForModeRun(call);
		const operation = stringValue(valueAt(metadata, 'operation'), 'request');
		const path = stringValue(valueAt(metadata, 'path'), '');
		const bodyPreview = valueAt(metadata, 'bodyPreview');
		const key = `${operation}:${path}:${JSON.stringify(bodyPreview ?? {})}`;
		const entry = byOperation.get(key) ?? {};
		const phase = stringValue(valueAt(metadata, 'phase'), '');
		if (phase === 'started') entry.started = call;
		if (phase === 'completed') entry.completed = call;
		if (phase === 'failed') entry.failed = call;
		byOperation.set(key, entry);
	}
	for (const [key, entry] of byOperation.entries()) {
		const chosen = entry.failed ?? entry.completed ?? entry.started;
		if (!chosen) continue;
		const { metadata } = metadataForModeRun(chosen);
		const phase = stringValue(valueAt(metadata, 'phase'), 'recorded');
		const tone: DetailRow['color'] = phase === 'failed' ? 'red' : phase === 'completed' ? 'green' : 'yellow';
		addWrapped(rows, `${phase.toUpperCase()} ${proxyRequestLabel(metadata)}`, width, { color: tone, bold: true });
		addWrapped(rows, `  endpoint=${stringValue(valueAt(metadata, 'path'))}`, width, { color: 'gray' });
		addWrapped(rows, `  duration=${formatDuration(valueAt(metadata, 'durationMs'))} http=${stringValue(valueAt(metadata, 'httpStatus'))} resultKeys=${readableList(valueAt(metadata, 'resultKeys'))}`, width, { color: 'gray' });
		const bodyPreview = valueAt(metadata, 'bodyPreview');
		if (isRecord(bodyPreview)) {
			for (const [requestKey, requestValue] of Object.entries(bodyPreview)) {
				if (requestValue !== undefined) addWrapped(rows, `  request.${requestKey}=${compactScalar(requestValue)}`, width, { color: 'gray' });
			}
		}
		if (valueAt(metadata, 'errorMessage')) addWrapped(rows, `  error=${stringValue(valueAt(metadata, 'errorMessage'))}`, width, { color: 'red' });
	}
}

function addTreeDxEvidence(rows: DetailRow[], workPackage: Record<string, unknown>, width: number) {
	const evidence = treeDxEvidenceRecords(workPackage);
	if (!evidence.length) {
		rows.push({ text: 'No TreeDX evidence records were captured.', color: 'red' });
		return;
	}
	for (const [index, entry] of evidence.entries()) {
		addWrapped(rows, `evidence ${index + 1}: ${stringValue(valueAt(entry, 'id'), 'treedx-evidence')} (${stringValue(valueAt(entry, 'purpose'), 'context')})`, width, { color: 'cyan', bold: true });
		addRecordFields(rows, '  source ref', valueAt(entry, 'sourceRef'), width - 2, 'gray');
		const files = Array.isArray(valueAt(entry, 'files')) ? valueAt(entry, 'files') as unknown[] : [];
		for (const file of files.filter(isRecord)) {
			addWrapped(rows, `  file: ${stringValue(valueAt(file, 'path'))}`, width, { color: 'green' });
			addWrapped(rows, `    ${renderValuePreview(valueAt(file, 'text'), width - 4)}`, width, { color: 'white' });
		}
		const pack = valueAt(entry, 'pack');
		if (pack !== undefined) {
			addWrapped(rows, `  context pack: ${renderValuePreview(pack, width - 2)}`, width, { color: 'gray' });
		}
		const results = valueAt(entry, 'results') ?? valueAt(entry, 'response');
		if (results !== undefined) {
			addWrapped(rows, `  result: ${renderValuePreview(results, width - 2)}`, width, { color: 'gray' });
		}
		const queries = Array.isArray(valueAt(entry, 'queries')) ? valueAt(entry, 'queries') as unknown[] : [];
		for (const query of queries.filter(isRecord)) {
			addWrapped(rows, `  configured query: ${stringValue(valueAt(query, 'id'), 'query')} (${stringValue(valueAt(query, 'purpose'), 'context')})`, width, { color: 'magenta' });
			addWrapped(rows, `    ${stringValue(valueAt(query, 'query'), '')}`, width, { color: 'white' });
			addWrapped(rows, `    scopes=${renderValuePreview(valueAt(query, 'codeScopes'), width - 6)} budget=${stringValue(valueAt(query, 'budget'))} depth=${stringValue(valueAt(query, 'depth'))}`, width, { color: 'gray' });
		}
		const warnings = Array.isArray(valueAt(entry, 'warnings')) ? valueAt(entry, 'warnings') as unknown[] : [];
		for (const warning of warnings) addWrapped(rows, `  warning: ${String(warning)}`, width, { color: 'red' });
	}
}

function contentArtifactRows(record: WorkdayLogViewRecord, width: number) {
	const rows: DetailRow[] = [];
	const artifacts = uniqueArtifactsForRecord(record);
	if (artifacts.length === 0) {
		rows.push({ text: 'No content artifacts recorded.', color: 'gray' });
		return rows;
	}
	for (const artifact of artifacts) {
		const path = stringValue(valueAt(artifact, 'contentPath') ?? valueAt(artifact, 'uri'), 'artifact?');
		addWrapped(rows, `${stringValue(valueAt(artifact, 'artifactKind'), 'artifact')} -> ${path}`, width, { color: 'green' });
		addWrapped(rows, `model=${stringValue(valueAt(artifact, 'model'))} subject=${stringValue(valueAt(artifact, 'subjectId'))} producedBy=${stringValue(valueAt(artifact, 'producedByAgent'))}`, width, { color: 'gray' });
	}
	return rows;
}

function uniqueArtifactsForRecord(record: WorkdayLogViewRecord) {
	const artifacts = Array.isArray(valueAt(record, 'contentArtifactRefs')) ? valueAt(record, 'contentArtifactRefs') as unknown[] : [];
	const byKey = new Map<string, Record<string, unknown>>();
	for (const artifact of artifacts.filter(isRecord)) {
		const key = stringValue(valueAt(artifact, 'contentPath') ?? valueAt(artifact, 'uri') ?? valueAt(artifact, 'id'), JSON.stringify(artifact));
		byKey.set(key, artifact);
	}
	return [...byKey.values()];
}

function providerMessageRows(record: WorkdayLogViewRecord) {
	return modeRunRecords(record).filter((modeRun) => sourceForModeRun(modeRun) === 'provider_runner_message');
}

function executionLifecycleRows(record: WorkdayLogViewRecord) {
	return modeRunRecords(record).filter((modeRun) => {
		const source = sourceForModeRun(modeRun);
		return source === 'execution_provider_starting' || source === 'execution_provider_adapter_lifecycle';
	});
}

function addAgentConfiguration(rows: DetailRow[], record: WorkdayLogViewRecord, width: number) {
	const starting = executionLifecycleRows(record).find((modeRun) => sourceForModeRun(modeRun) === 'execution_provider_starting');
	const { metadata } = starting ? metadataForModeRun(starting) : { metadata: {} };
	const agent = isRecord(valueAt(metadata, 'agent')) ? valueAt(metadata, 'agent') as Record<string, unknown> : {};
	const execution = isRecord(valueAt(agent, 'execution')) ? valueAt(agent, 'execution') as Record<string, unknown> : {};
	const handoff = valueAt(agent, 'handoff');
	if (Object.keys(agent).length === 0) {
		rows.push({ text: 'No execution-start agent configuration snapshot was captured.', color: 'yellow' });
		return;
	}
	addField(rows, 'agent slug', valueAt(agent, 'slug'), width, 'cyan');
	addField(rows, 'agent name', valueAt(agent, 'name'), width, 'white');
	addField(rows, 'handler', valueAt(agent, 'handler'), width, 'gray');
	addField(rows, 'context query count', valueAt(agent, 'contextQueryCount'), width, 'gray');
	addField(rows, 'execution provider', valueAt(execution, 'provider'), width, 'gray');
	addField(rows, 'execution model', valueAt(execution, 'model'), width, 'cyan');
	addField(rows, 'sandbox', valueAt(execution, 'sandboxMode'), width, 'gray');
	addField(rows, 'approval policy', valueAt(execution, 'approvalPolicy'), width, 'gray');
	addField(rows, 'allowed paths', readableList(valueAt(execution, 'allowedPaths')), width, 'green');
	addField(rows, 'forbidden paths', readableList(valueAt(execution, 'forbiddenPaths')), width, 'red');
	if (isRecord(handoff)) {
		addField(rows, 'handoff output model', valueAt(handoff, 'outputModel') ?? valueAt(handoff, 'model'), width, 'gray');
		addField(rows, 'handoff artifact kind', valueAt(handoff, 'artifactKind'), width, 'gray');
		addField(rows, 'handoff collection', valueAt(handoff, 'targetCollection') ?? valueAt(handoff, 'collection'), width, 'gray');
	}
}

function addForensicOverview(rows: DetailRow[], input: {
	record: WorkdayLogViewRecord;
	workPackage: Record<string, unknown>;
	codex: Record<string, unknown>;
	codexUsage: Record<string, unknown>;
	codexRequest: Record<string, unknown>;
	width: number;
}) {
	const { record, workPackage, codex, codexUsage, codexRequest, width } = input;
	const agent = agentRecord(record);
	const assignment = assignmentRecord(record);
	const timing = timingRecord(record);
	const proxyCalls = treeDxProxyModeRuns(record);
	const proxyFailures = proxyCalls.filter((modeRun) => {
		const { metadata } = metadataForModeRun(modeRun);
		return valueAt(metadata, 'phase') === 'failed';
	});
	const evidence = treeDxEvidenceRecords(workPackage);
	const artifacts = uniqueArtifactsForRecord(record);
	const messages = providerMessageRows(record);
	const finalResponse = stringValue(valueAt(codex, 'finalResponse'), '');
	const responseStatus = finalResponse.startsWith('TASK_WAITING') ? 'TASK_WAITING' : finalResponse ? 'responded' : 'missing';
	addSection(rows, 'Agent Run Summary');
	addWrapped(rows, `${stringValue(valueAt(agent, 'agentId'), 'agent?')} on ${stringValue(valueAt(agent, 'projectSlug') ?? valueAt(agent, 'projectId'), 'project?')} (${stringValue(valueAt(record, 'mode'), 'mode?')})`, width, { color: 'cyan', bold: true });
	addCompactKV(rows, 'state', [
		['run', valueAt(record, 'status')],
		['assignment', valueAt(assignment, 'status')],
		['lease', valueAt(assignment, 'leaseState')],
		['runner', valueAt(assignment, 'runnerId')],
	], width);
	addCompactKV(rows, 'time', [
		['started', valueAt(timing, 'startedAt') ?? valueAt(timing, 'createdAt')],
		['finished', valueAt(timing, 'finishedAt') ?? valueAt(timing, 'completedAt') ?? valueAt(timing, 'failedAt')],
		['duration', formatDuration(valueAt(timing, 'durationMs'))],
		['modelWall', `${stringValue(valueAt(codexUsage, 'wallMs'))}ms`],
	], width);
	addCompactKV(rows, 'AI', [
		['provider', valueAt(codex, 'provider') ?? 'codex'],
		['model', valueAt(codexRequest, 'model')],
		['status', valueAt(codex, 'status')],
		['response', responseStatus],
		['promptChars', valueAt(codexRequest, 'promptCharacters')],
	], width);
	addCompactKV(rows, 'tokens', [
		['input', valueAt(codexUsage, 'inputTokens')],
		['output', valueAt(codexUsage, 'outputTokens')],
		['cached', valueAt(codexUsage, 'cachedInputTokens')],
		['filesChanged', valueAt(codexUsage, 'filesChanged')],
	], width);
	addCompactKV(rows, 'TreeDX', [
		['proxyCalls', proxyCalls.length],
		['proxyFailures', proxyFailures.length],
		['evidenceRecords', evidence.length],
		['artifacts', artifacts.length],
		['messages', messages.length],
	], width);
	if (proxyFailures.length) {
		for (const failed of proxyFailures.slice(0, 4)) {
			const { metadata } = metadataForModeRun(failed);
			addWrapped(rows, `TreeDX failure: ${stringValue(valueAt(metadata, 'operation'))} ${stringValue(valueAt(metadata, 'errorMessage'))}`, width, { color: 'red' });
		}
	}
	if (finalResponse) {
		addWrapped(rows, `AI response preview: ${truncateLine(finalResponse.replace(/\s+/gu, ' '), width - 2)}`, width, { color: responseStatus === 'TASK_WAITING' ? 'red' : 'white' });
	}
}

function addCodexRawItems(rows: DetailRow[], codex: Record<string, unknown>, width: number) {
	const rawItems = recordsFrom(recordFromPath(codex, ['metadata']).rawItems);
	if (!rawItems.length) {
		rows.push({ text: 'No raw Codex SDK event items were captured for this execution.', color: 'yellow' });
		return;
	}
	for (const [index, item] of rawItems.entries()) {
		const label = stringValue(valueAt(item, 'type') ?? valueAt(item, 'kind'), 'event');
		addWrapped(rows, `${index + 1}. ${label} id=${stringValue(valueAt(item, 'id'))}`, width, { color: 'cyan', bold: true });
		for (const [key, value] of Object.entries(item)) {
			if (['id', 'type', 'kind'].includes(key)) continue;
			addWrapped(rows, `   ${key}: ${compactScalar(value)}`, width, { color: 'gray' });
		}
	}
}

function addWorkPackageSummary(rows: DetailRow[], workPackage: Record<string, unknown>, width: number) {
	if (!Object.keys(workPackage).length) {
		rows.push({ text: 'No work package snapshot was captured.', color: 'red' });
		return;
	}
	addField(rows, 'kind', valueAt(workPackage, 'kind'), width, 'gray');
	addField(rows, 'title', valueAt(workPackage, 'title'), width, 'white');
	addField(rows, 'summary', valueAt(workPackage, 'summary'), width, 'gray');
	const expectedOutputs = recordsFrom(valueAt(workPackage, 'expectedOutputs'));
	if (expectedOutputs.length) {
		rows.push({ text: 'expected outputs', color: 'cyan', bold: true });
		for (const output of expectedOutputs) {
			addBullet(rows, `${stringValue(valueAt(output, 'type'))}: ${stringValue(valueAt(output, 'description'))}`, width, 'gray');
		}
	}
	const constraints = isRecord(valueAt(workPackage, 'constraints')) ? valueAt(workPackage, 'constraints') as Record<string, unknown> : {};
	if (Object.keys(constraints).length) {
		addField(rows, 'mode', valueAt(constraints, 'mode'), width, 'gray');
		addField(rows, 'allowed paths', readableList(valueAt(constraints, 'allowedPaths')), width, 'green');
		addField(rows, 'forbidden paths', readableList(valueAt(constraints, 'forbiddenPaths')), width, 'red');
	}
}

function buildDetailRows(record: WorkdayLogViewRecord | null, width: number) {
	const rows: DetailRow[] = [];
	if (!record) {
		return [{ text: 'No execution selected.', color: 'gray' }];
	}
	const agent = agentRecord(record);
	const assignment = assignmentRecord(record);
	const timing = timingRecord(record);
	const provider = executionProviderRecord(record);
	const modeRuns = modeRunRecords(record);
	const codex = codexRunRecord(record);
	const codexMetadata = isRecord(valueAt(codex, 'metadata')) ? valueAt(codex, 'metadata') as Record<string, unknown> : {};
	const codexRequest = isRecord(valueAt(codexMetadata, 'request')) ? valueAt(codexMetadata, 'request') as Record<string, unknown> : {};
	const usage = tokenUsage(record);
	const workPackages = collectWorkPackages(record);
	const primaryWorkPackage = selectPrimaryWorkPackage(workPackages);
	const workPackageContext = contextRecordFromWorkPackage(primaryWorkPackage);
	const contextDiagnostics = valueAt(workPackageContext, 'contextDiagnostics') ?? valueAt(primaryWorkPackage, 'contextDiagnostics');
	const treeDxHandle = isRecord(contextDiagnostics) ? recordFromPath(contextDiagnostics, ['treeDxProxyHandle']) : {};
	const artifacts = uniqueArtifactsForRecord(record);
	const messages = providerMessageRows(record);
	const proxyCalls = treeDxProxyModeRuns(record);
	const proxyFailures = proxyCalls.filter((modeRun) => valueAt(metadataForModeRun(modeRun).metadata, 'phase') === 'failed');
	const evidence = treeDxEvidenceRecords(primaryWorkPackage);
	const finalResponse = stringValue(valueAt(codex, 'finalResponse'), '');
	const objective = valueAt(selectedInputRecord(record), 'objective');

	addSection(rows, 'Run');
	addWrapped(rows, `${stringValue(valueAt(agent, 'agentId'), 'agent?')} / ${stringValue(valueAt(record, 'mode'), 'mode?')} / ${cycleLabel(record)}`, width, { color: 'cyan', bold: true });
	addCompactKV(rows, 'state', [
		['execution', valueAt(record, 'status')],
		['assignment', valueAt(assignment, 'status')],
		['lease', valueAt(assignment, 'leaseState')],
		['runner', valueAt(assignment, 'runnerId')],
	], width);
	addCompactKV(rows, 'time', [
		['started', valueAt(timing, 'startedAt') ?? valueAt(timing, 'createdAt')],
		['finished', valueAt(timing, 'finishedAt') ?? valueAt(timing, 'completedAt') ?? valueAt(timing, 'failedAt')],
		['duration', compactDurationForRecord(record)],
	], width);
	addCompactKV(rows, 'work', [
		['project', valueAt(agent, 'projectSlug') ?? valueAt(agent, 'projectId')],
		['class', valueAt(agent, 'projectAgentClassId') ?? valueAt(agent, 'classSlug')],
		['handler', valueAt(agent, 'handlerId')],
		['artifact', artifactKindLabel(record)],
		['subject', subjectLabel(record)],
	], width);
	if (objective) addWrapped(rows, `objective: ${stringValue(objective)}`, width, { color: 'white' });

	addSection(rows, 'AI');
	addCompactKV(rows, 'model', [
		['provider', valueAt(codex, 'provider') ?? valueAt(provider, 'id') ?? 'codex'],
		['model', valueAt(codexRequest, 'model')],
		['reasoning', valueAt(codexRequest, 'reasoningEffort')],
		['sandbox', valueAt(codexRequest, 'sandboxMode')],
		['approval', valueAt(codexRequest, 'approvalPolicy')],
	], width);
	addCompactKV(rows, 'usage', [
		['inputTokens', usage.input],
		['outputTokens', usage.output],
		['cachedTokens', usage.cached],
		['wall', formatDuration(usage.wallMs)],
		['promptChars', valueAt(codexRequest, 'promptCharacters')],
	], width);
	if (!Object.keys(codex).length) rows.push({ text: 'No AI model snapshot was captured for this execution.', color: 'red' });
	if (finalResponse) addWrapped(rows, `response: ${truncateLine(finalResponse.replace(/\s+/gu, ' '), width - 2)}`, width, { color: finalResponse.startsWith('TASK_WAITING') ? 'red' : 'white' });

	addSection(rows, 'Context');
	const coreObjective = recordFromPath(workPackageContext, ['coreObjective']);
	addCompactKV(rows, 'TreeDX', [
		['available', isRecord(contextDiagnostics) ? valueAt(contextDiagnostics, 'treeDxAvailable') : null],
		['coreObjective', isRecord(contextDiagnostics) ? valueAt(contextDiagnostics, 'coreObjectiveIncluded') : Boolean(Object.keys(coreObjective).length)],
		['evidence', evidence.length],
		['proxyCalls', proxyCalls.length],
		['proxyFailures', proxyFailures.length],
	], width);
	addFieldIfPresent(rows, 'core objective', valueAt(coreObjective, 'path') ?? (String(JSON.stringify(workPackageContext)).includes('src/content/objectives/core.md') ? 'src/content/objectives/core.md' : null), width, 'green');
	if (Object.keys(treeDxHandle).length) {
		addField(rows, 'read paths', readableList(valueAt(treeDxHandle, 'allowedReadPaths') ?? valueAt(treeDxHandle, 'allowedPaths')), width, 'green');
		addField(rows, 'write paths', readableList(valueAt(treeDxHandle, 'allowedWritePaths') ?? valueAt(treeDxHandle, 'allowedPaths')), width, 'yellow');
	}
	for (const modeRun of proxyCalls.slice(-8)) {
		const metadata = metadataForModeRun(modeRun).metadata;
		if (valueAt(metadata, 'phase') !== 'completed' && valueAt(metadata, 'phase') !== 'failed') continue;
		addWrapped(rows, `${stringValue(valueAt(metadata, 'operation'))}: ${stringValue(valueAt(metadata, 'httpStatus'))} in ${formatDuration(valueAt(metadata, 'durationMs'))}`, width, { color: valueAt(metadata, 'phase') === 'failed' ? 'red' : 'gray' });
	}

	addSection(rows, 'Artifacts');
	if (!artifacts.length) {
		rows.push({ text: 'No content artifacts recorded.', color: 'gray' });
	} else {
		for (const artifact of artifacts) {
			addWrapped(rows, `${stringValue(valueAt(artifact, 'artifactKind'), 'artifact')} -> ${stringValue(valueAt(artifact, 'contentPath') ?? valueAt(artifact, 'uri'))}`, width, { color: 'green' });
		}
	}

	addSection(rows, 'Messages');
	if (!messages.length) {
		rows.push({ text: 'No messages or signals recorded.', color: 'gray' });
	} else {
		for (const message of messages.slice(0, 10)) {
			const outputs = isRecord(valueAt(message, 'outputs')) ? valueAt(message, 'outputs') as Record<string, unknown> : {};
			const metadata = isRecord(valueAt(outputs, 'metadata')) ? valueAt(outputs, 'metadata') as Record<string, unknown> : {};
			const providerMessage = isRecord(valueAt(metadata, 'message')) ? valueAt(metadata, 'message') as Record<string, unknown> : {};
			addWrapped(rows, `${stringValue(valueAt(providerMessage, 'type') ?? valueAt(outputs, 'summary'), 'message')} ${stringValue(valueAt(providerMessage, 'status'), '')}`, width, { color: 'white' });
		}
	}

	addSection(rows, 'Timeline');
	addField(rows, 'telemetry events', modeRuns.length, width, 'gray');
	for (const modeRun of modeRuns.filter((entry) => {
		const source = sourceForModeRun(entry);
		return source.startsWith('provider_runner_') || source.startsWith('execution_provider_') || source.startsWith('agent_kernel_');
	}).slice(0, 18)) {
		const outputs = isRecord(valueAt(modeRun, 'outputs')) ? valueAt(modeRun, 'outputs') as Record<string, unknown> : {};
		addWrapped(rows, `${stringValue(valueAt(modeRun, 'createdAt') ?? valueAt(modeRun, 'startedAt'), 'time?')} ${stringValue(sourceForModeRun(modeRun), 'event')}: ${stringValue(valueAt(outputs, 'summary'), '').replace(/\s+/gu, ' ').slice(0, 140)}`, width, { color: 'gray' });
	}
	return rows.length > 0 ? rows : [{ text: '(empty)', color: 'gray' }];
}

function sidebarItemRect(layout: WorkdayLogLayout, section: WorkdayLogSection, index: number): UiRect {
	const top = section === 'planning' ? layout.topBarHeight + 2 : layout.topBarHeight + layout.planningHeight + 2;
	return {
		x: 1,
		y: top + index,
		width: layout.sidebarWidth - 2,
		height: 1,
	};
}

function WorkdayLogDetailPanel(props: {
	width: number;
	height: number;
	title: string;
	rows: DetailRow[];
	focused?: boolean;
	scrollState: ScrollRegionState;
}) {
	const contentRows = Math.max(1, props.height - 3);
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, height: props.height, borderStyle: 'round', borderColor: props.focused ? 'cyan' : 'gray', overflow: 'hidden' },
		React.createElement(Text, { color: 'yellow', bold: true }, truncateLine(props.title, props.width - 2)),
		...Array.from({ length: contentRows }, (_, index) => {
			const row = props.rows[index] ?? { text: '' };
			return React.createElement(Text, { key: `detail-${index}`, color: row.color ?? 'white', bold: row.bold }, truncateLine(row.text, props.width - 2));
		}),
		React.createElement(
			Text,
			{ color: 'gray' },
			truncateLine(
				`${props.scrollState.offset > 0 ? '↑' : ' '} ${props.scrollState.offset + props.scrollState.viewportSize < props.scrollState.totalSize ? '↓' : ' '} lines ${props.scrollState.totalSize === 0 ? '0-0' : `${Math.min(props.scrollState.totalSize, props.scrollState.offset + 1)}-${Math.min(props.scrollState.totalSize, props.scrollState.offset + props.scrollState.viewportSize)}`} of ${props.scrollState.totalSize}`,
				props.width - 2,
			),
		),
	);
}

function canRenderWorkdayLogUi() {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true' && process.env.ACT !== 'true');
}

export async function renderWorkdayLogInk(input: WorkdayLogUiInput) {
	if (!canRenderWorkdayLogUi()) {
		return null;
	}
	return await new Promise<number>((resolveSession) => {
		let finished = false;
		let instance: ReturnType<typeof render> | undefined;
		const finish = (exitCode: number) => {
			if (finished) return;
			finished = true;
			instance?.unmount();
			resolveSession(exitCode);
		};

		function App() {
			const { exit } = useApp();
			const windowSize = useWindowSize();
			const layout = computeWorkdayLogLayout(windowSize?.rows ?? 24, windowSize?.columns ?? 120);
			const planningRecords = input.records.filter((record) => modeOf(record) !== 'acting');
			const actingRecords = input.records.filter((record) => modeOf(record) === 'acting');
			const [focusArea, setFocusArea] = React.useState<WorkdayLogFocusArea>('planning');
			const [planningIndex, setPlanningIndex] = React.useState(0);
			const [actingIndex, setActingIndex] = React.useState(0);
			const [planningOffset, setPlanningOffset] = React.useState(0);
			const [actingOffset, setActingOffset] = React.useState(0);
			const [detailOffset, setDetailOffset] = React.useState(0);
			const activeRecords = focusArea === 'acting' ? actingRecords : planningRecords;
			const activeIndex = focusArea === 'acting' ? actingIndex : planningIndex;
			const selectedRecord = activeRecords[activeIndex] ?? planningRecords[planningIndex] ?? actingRecords[actingIndex] ?? null;
			const detailRows = React.useMemo(() => buildDetailRows(selectedRecord, layout.detailWidth - 3), [selectedRecord, layout.detailWidth]);
			const detailView = detailViewport(detailRows, layout.bodyHeight, detailOffset);
			const planningViewportSize = Math.max(1, layout.planningHeight - 3);
			const actingViewportSize = Math.max(1, layout.actingHeight - 3);
			const safePlanningOffset = clampOffset(ensureVisible(planningIndex, planningOffset, planningViewportSize), planningRecords.length, planningViewportSize);
			const safeActingOffset = clampOffset(ensureVisible(actingIndex, actingOffset, actingViewportSize), actingRecords.length, actingViewportSize);
			const visiblePlanning = planningRecords.slice(safePlanningOffset, safePlanningOffset + planningViewportSize);
			const visibleActing = actingRecords.slice(safeActingOffset, safeActingOffset + actingViewportSize);

			React.useEffect(() => {
				if (safePlanningOffset !== planningOffset) setPlanningOffset(safePlanningOffset);
			}, [safePlanningOffset, planningOffset]);
			React.useEffect(() => {
				if (safeActingOffset !== actingOffset) setActingOffset(safeActingOffset);
			}, [safeActingOffset, actingOffset]);
			React.useEffect(() => {
				if (detailView.offset !== detailOffset) setDetailOffset(detailView.offset);
			}, [detailView.offset, detailOffset]);
			React.useEffect(() => {
				setDetailOffset(0);
			}, [selectedRecord]);

			const planningRect: UiRect = { x: 0, y: layout.topBarHeight, width: layout.sidebarWidth, height: layout.planningHeight };
			const actingRect: UiRect = { x: 0, y: layout.topBarHeight + layout.planningHeight, width: layout.sidebarWidth, height: layout.actingHeight };
			const detailRect: UiRect = { x: layout.sidebarWidth + 1, y: layout.topBarHeight, width: layout.detailWidth, height: layout.bodyHeight };
			const clickRegions: UiClickRegion[] = [
				...visiblePlanning.map((record, index) => ({
					id: `planning:${String(valueAt(record, 'id') ?? index)}`,
					rect: sidebarItemRect(layout, 'planning', index),
					onClick: () => {
						setFocusArea('planning');
						setPlanningIndex(safePlanningOffset + index);
					},
				})),
				...visibleActing.map((record, index) => ({
					id: `acting:${String(valueAt(record, 'id') ?? index)}`,
					rect: sidebarItemRect(layout, 'acting', index),
					onClick: () => {
						setFocusArea('acting');
						setActingIndex(safeActingOffset + index);
					},
				})),
			];
			const scrollRegions: UiScrollRegion[] = [
				{
					id: 'planning',
					rect: planningRect,
					state: { offset: safePlanningOffset, viewportSize: planningViewportSize, totalSize: planningRecords.length },
					onScroll: (offset) => {
						setPlanningOffset(offset);
						setPlanningIndex(offset);
					},
					onFocus: () => setFocusArea('planning'),
				},
				{
					id: 'acting',
					rect: actingRect,
					state: { offset: safeActingOffset, viewportSize: actingViewportSize, totalSize: actingRecords.length },
					onScroll: (offset) => {
						setActingOffset(offset);
						setActingIndex(offset);
					},
					onFocus: () => setFocusArea('acting'),
				},
				{
					id: 'detail',
					rect: detailRect,
					state: { offset: detailView.offset, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize },
					onScroll: (offset) => setDetailOffset(offset),
					onFocus: () => setFocusArea('detail'),
				},
			];

			useTerminalMouse((event) => {
				if (event.button === 'scroll-up' || event.button === 'scroll-down') {
					routeWheelDeltaToScrollRegion(scrollRegions, event.x, event.y, event.button === 'scroll-up' ? -1 : 1);
					return;
				}
				if (event.action === 'release' && event.button === 'left') {
					findClickableRegion(clickRegions, event.x, event.y)?.onClick();
				}
			}, { enabled: input.mouseEnabled === true });

			useInput((inputKey, key) => {
				if ((key.ctrl && inputKey === 'c') || key.escape || inputKey === 'q') {
					exit();
					finish(0);
					return;
				}
				if (key.tab) {
					setFocusArea((current) => current === 'planning' ? 'acting' : current === 'acting' ? 'detail' : 'planning');
					return;
				}
				if (focusArea === 'detail') {
					if (key.upArrow || inputKey === 'k') setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
					if (key.downArrow || inputKey === 'j') setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
					if (key.pageUp) setDetailOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
					if (key.pageDown) setDetailOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
					return;
				}
				if (focusArea === 'planning') {
					if (key.upArrow || inputKey === 'k') setPlanningIndex((current) => Math.max(0, current - 1));
					if (key.downArrow || inputKey === 'j') setPlanningIndex((current) => Math.min(Math.max(0, planningRecords.length - 1), current + 1));
					if (key.pageUp) setPlanningIndex((current) => Math.max(0, current - planningViewportSize));
					if (key.pageDown) setPlanningIndex((current) => Math.min(Math.max(0, planningRecords.length - 1), current + planningViewportSize));
					if (key.return) setFocusArea('detail');
					return;
				}
				if (focusArea === 'acting') {
					if (key.upArrow || inputKey === 'k') setActingIndex((current) => Math.max(0, current - 1));
					if (key.downArrow || inputKey === 'j') setActingIndex((current) => Math.min(Math.max(0, actingRecords.length - 1), current + 1));
					if (key.pageUp) setActingIndex((current) => Math.max(0, current - actingViewportSize));
					if (key.pageDown) setActingIndex((current) => Math.min(Math.max(0, actingRecords.length - 1), current + actingViewportSize));
					if (key.return) setFocusArea('detail');
				}
			});

			const topBar = React.createElement(
				Box,
				{ flexDirection: 'column', width: layout.columns, overflow: 'hidden' },
				React.createElement(Text, { backgroundColor: 'cyan', color: 'black', bold: true }, truncateLine(` ${input.title} `, layout.columns)),
				React.createElement(Text, { color: 'white' }, truncateLine(input.subtitle, layout.columns)),
				React.createElement(Text, { color: 'gray' }, truncateLine(`Executions=${input.records.length} Planning=${planningRecords.length} Acting=${actingRecords.length}`, layout.columns)),
			);

			const body = React.createElement(
				Box,
				{ width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
				React.createElement(
					Box,
					{ flexDirection: 'column', width: layout.sidebarWidth, height: layout.bodyHeight, overflow: 'hidden' },
					React.createElement(SidebarList, {
						width: layout.sidebarWidth,
						height: layout.planningHeight,
						title: `Planning Mode${focusArea === 'planning' ? ' • active' : ''}`,
						focused: focusArea === 'planning',
						scrollState: { offset: safePlanningOffset, viewportSize: planningViewportSize, totalSize: planningRecords.length },
						items: visiblePlanning.map((record, index) => ({
							id: String(valueAt(record, 'id') ?? index),
							label: `${recordLabel(record)} (${artifactCount(record)})`,
							active: focusArea !== 'acting' && selectedRecord === record,
							tone: recordTone(record),
						})),
					}),
					React.createElement(SidebarList, {
						width: layout.sidebarWidth,
						height: layout.actingHeight,
						title: `Acting Mode${focusArea === 'acting' ? ' • active' : ''}`,
						focused: focusArea === 'acting',
						scrollState: { offset: safeActingOffset, viewportSize: actingViewportSize, totalSize: actingRecords.length },
						items: visibleActing.map((record, index) => ({
							id: String(valueAt(record, 'id') ?? index),
							label: `${recordLabel(record)} (${artifactCount(record)})`,
							active: focusArea === 'acting' && selectedRecord === record,
							tone: recordTone(record),
						})),
					}),
				),
				React.createElement(Text, null, ' '),
				React.createElement(WorkdayLogDetailPanel, {
					width: layout.detailWidth,
					height: layout.bodyHeight,
					title: `Agent Execution Detail${focusArea === 'detail' ? ' • active' : ''}`,
					focused: focusArea === 'detail',
					rows: detailView.rows,
					scrollState: { offset: detailView.offset, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize },
				}),
			);

			const footer = React.createElement(StatusBar, {
				width: layout.columns,
				accent: focusArea === 'detail',
				primary: 'Arrows/j/k move. Enter opens detail. Tab switches planning, acting, and detail. Wheel/PgUp/PgDn scroll. q exits.',
				secondary: `Focus: ${focusArea}. Mouse capture ${input.mouseEnabled === true ? 'enabled' : 'disabled'}.`,
			});

			return React.createElement(AppFrame, { layout, topBar, body, footer });
		}

		instance = render(React.createElement(App), { exitOnCtrlC: false });
	});
}
