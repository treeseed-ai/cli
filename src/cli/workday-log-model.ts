import { clampOffset, computeViewportLayout, wrapText } from './ui/framework.js';
import type { DetailRow, WorkdayLogViewRecord } from './workday-log-types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function valueAt(record: Record<string, unknown> | undefined, key: string) {
	return record ? record[key] : undefined;
}

export function stringValue(value: unknown, fallback = 'n/a') {
	if (value === null || value === undefined || value === '') return fallback;
	return String(value);
}

export function numberValue(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return null;
}

export function formatDuration(ms: unknown) {
	const value = numberValue(ms);
	if (value === null) return 'n/a';
	if (value < 1000) return `${Math.round(value)}ms`;
	if (value >= 60_000) return `${(value / 60_000).toFixed(2)}m`;
	return `${(value / 1000).toFixed(2)}s`;
}

export function artifactCount(record: WorkdayLogViewRecord) {
	const artifacts = valueAt(record, 'contentArtifactRefs');
	return Array.isArray(artifacts) ? artifacts.length : 0;
}

export function modeOf(record: WorkdayLogViewRecord) {
	return stringValue(valueAt(record, 'mode'), 'unknown').toLowerCase();
}

export function agentRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'agent');
	return isRecord(value) ? value : {};
}

export function assignmentRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'assignment');
	return isRecord(value) ? value : {};
}

export function timingRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'timing');
	return isRecord(value) ? value : {};
}

export function executionProviderRecord(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'executionProvider');
	return isRecord(value) ? value : {};
}

export function modeRunRecords(record: WorkdayLogViewRecord) {
	const value = valueAt(record, 'modeRuns');
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function recordLabel(record: WorkdayLogViewRecord) {
	const agent = agentRecord(record);
	const timing = timingRecord(record);
	const startedAt = stringValue(valueAt(timing, 'startedAt') ?? valueAt(timing, 'createdAt'), 'time?');
	const time = startedAt.includes('T') ? startedAt.slice(11, 19) : startedAt;
	const artifacts = artifactCount(record);
	return `${time} ${stringValue(valueAt(agent, 'agentId'), 'agent?')}${artifacts ? ` (${artifacts})` : ''}`;
}

export function recordTone(record: WorkdayLogViewRecord): 'required' | 'normal' {
	const status = stringValue(valueAt(record, 'status'), '').toLowerCase();
	return status === 'failed' || status === 'blocked' ? 'required' : 'normal';
}

export function computeWorkdayLogLayout(rows: number, columns: number) {
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

export function detailViewport(rows: DetailRow[], height: number, offset: number) {
	const viewportSize = Math.max(1, height - 3);
	const safeOffset = clampOffset(offset, rows.length, viewportSize);
	return {
		rows: rows.slice(safeOffset, safeOffset + viewportSize),
		offset: safeOffset,
		viewportSize,
		totalSize: rows.length,
	};
}

export function addWrapped(rows: DetailRow[], text: string, width: number, style: Omit<DetailRow, 'text'> = {}) {
	for (const line of wrapText(text, width)) {
		rows.push({ text: line, ...style });
	}
}

export function addSection(rows: DetailRow[], title: string) {
	if (rows.length && rows.at(-1)?.text !== '') rows.push({ text: '' });
	rows.push({ text: title, color: 'yellow', bold: true });
}

export function addField(rows: DetailRow[], label: string, value: unknown, width: number, color: DetailRow['color'] = 'white') {
	addWrapped(rows, `${label}: ${stringValue(value)}`, width, { color });
}

export function addTextBlock(rows: DetailRow[], title: string, value: unknown, width: number, color: DetailRow['color'] = 'white') {
	if (value === undefined || value === null || value === '') return;
	rows.push({ text: title, color: 'cyan', bold: true });
	for (const line of String(value).split('\n')) {
		addWrapped(rows, line.trimEnd() || ' ', width, { color });
	}
}

export function compactDurationForRecord(record: WorkdayLogViewRecord) {
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

export function selectedInputRecord(record: WorkdayLogViewRecord) {
	return recordFromPath(record, ['input', 'selectedInput']);
}

export function cycleLabel(record: WorkdayLogViewRecord) {
	const input = selectedInputRecord(record);
	const cycle = valueAt(input, 'cycle');
	return cycle === undefined || cycle === null ? 'cycle n/a' : `cycle ${String(cycle)}`;
}

export function subjectLabel(record: WorkdayLogViewRecord) {
	const input = selectedInputRecord(record);
	return `${stringValue(valueAt(input, 'subjectModel'))}:${stringValue(valueAt(input, 'subjectId'))}`;
}

export function artifactKindLabel(record: WorkdayLogViewRecord) {
	const input = selectedInputRecord(record);
	const artifacts = uniqueArtifactsForRecord(record);
	return stringValue(valueAt(input, 'artifactKind') ?? valueAt(artifacts[0], 'artifactKind'), 'n/a');
}

export function tokenUsage(record: WorkdayLogViewRecord) {
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

export function firstRecord(...values: unknown[]) {
	return values.find(isRecord) as Record<string, unknown> | undefined;
}

export function recordFromPath(root: unknown, path: string[]) {
	let current: unknown = root;
	for (const key of path) {
		if (!isRecord(current)) return {};
		current = current[key];
	}
	return isRecord(current) ? current : {};
}

export function arrayFromPath(root: unknown, path: string[]) {
	let current: unknown = root;
	for (const key of path) {
		if (!isRecord(current)) return [];
	current = current[key];
	}
	return Array.isArray(current) ? current : [];
}

export function recordsFrom(value: unknown) {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function collectWorkPackages(record: WorkdayLogViewRecord) {
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

export function workPackageForensicScore(workPackage: Record<string, unknown>) {
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

export function selectPrimaryWorkPackage(workPackages: Record<string, unknown>[]) {
	return [...workPackages].sort((left, right) => workPackageForensicScore(right) - workPackageForensicScore(left))[0] ?? {};
}

export function codexRunRecord(record: WorkdayLogViewRecord) {
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

export function contextRecordFromWorkPackage(workPackage: Record<string, unknown>) {
	return isRecord(valueAt(workPackage, 'context')) ? valueAt(workPackage, 'context') as Record<string, unknown> : {};
}

export function treeDxEvidenceRecords(workPackage: Record<string, unknown>) {
	return arrayFromPath(workPackage, ['context', 'treeDxEvidence']).filter(isRecord);
}

export function renderValuePreview(value: unknown, width: number) {
	if (value === undefined || value === null) return 'n/a';
	if (typeof value === 'string') return truncateLine(value.replace(/\s+/gu, ' ').trim(), width);
	if (Array.isArray(value)) return `${value.length} item(s)`;
	if (isRecord(value)) {
		const keys = Object.keys(value);
		return truncateLine(keys.length ? keys.slice(0, 8).join(', ') : '{}', width);
	}
	return String(value);
}

export function compactScalar(value: unknown) {
	if (typeof value === 'string') return value.replace(/\s+/gu, ' ').trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null || value === undefined) return 'n/a';
	return renderValuePreview(value, 120);
}

export function readableList(values: unknown, fallback = 'none') {
	if (!Array.isArray(values) || values.length === 0) return fallback;
	return values.map((entry) => compactScalar(entry)).filter(Boolean).join(', ') || fallback;
}

export function addBullet(rows: DetailRow[], text: string, width: number, color: DetailRow['color'] = 'white') {
	addWrapped(rows, `- ${text}`, width, { color });
}

export function addFieldIfPresent(rows: DetailRow[], label: string, value: unknown, width: number, color: DetailRow['color'] = 'white') {
	if (value === undefined || value === null || value === '') return;
	addField(rows, label, value, width, color);
}

export function addCompactKV(rows: DetailRow[], label: string, values: Array<[string, unknown]>, width: number) {
	const rendered = values
		.filter(([, value]) => value !== undefined && value !== null && value !== '')
		.map(([key, value]) => `${key}=${compactScalar(value)}`)
		.join('  ');
	addField(rows, label, rendered || 'n/a', width, 'gray');
}

export function addRecordFields(rows: DetailRow[], title: string, value: unknown, width: number, color: DetailRow['color'] = 'gray') {
	if (!isRecord(value) || Object.keys(value).length === 0) return;
	rows.push({ text: title, color: 'cyan', bold: true });
	for (const [key, entry] of Object.entries(value)) {
		addWrapped(rows, `${key}: ${compactScalar(entry)}`, width, { color });
	}
}

export function addStructuredValue(rows: DetailRow[], title: string, value: unknown, width: number, color: DetailRow['color'] = 'gray', maxLines = 18) {
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

