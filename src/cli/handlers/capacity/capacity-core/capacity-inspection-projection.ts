import { decorateExecutionProviderVisibility, summarizeExecutionProviderVisibility, type ExecutionProviderVisibilitySummary } from '@treeseed/sdk/agent-capacity';
import { capacityRecordValue, isCapacityRecord } from './capacity-values.js';

function summarizeRecord(record: unknown) {
	if (!isCapacityRecord(record)) return String(record ?? '');
	const id = String(record.id ?? record.assignmentId ?? record.sessionId ?? record.classId ?? 'record');
	const state = record.status ?? record.state ?? record.leaseState ?? record.mode ?? record.kind ?? null;
	return [id, state ? String(state) : null, record.projectId ? `project=${String(record.projectId)}` : null, record.providerId ? `provider=${String(record.providerId)}` : null, record.mode ? `mode=${String(record.mode)}` : null, record.updatedAt ? `updated=${String(record.updatedAt)}` : record.createdAt ? `created=${String(record.createdAt)}` : null].filter(Boolean).join(' | ');
}

function executionLabel(visibility: ExecutionProviderVisibilitySummary) {
	return visibility.executionProviderKind ?? visibility.executionProviderId ?? 'none';
}

function externalLabel(visibility: ExecutionProviderVisibilitySummary) {
	return visibility.externalRef ?? 'none';
}

function summarizeAssignmentRecord(record: unknown) {
	if (!isCapacityRecord(record)) return String(record ?? '');
	const visibility = summarizeExecutionProviderVisibility({ assignment: record, explanation: capacityRecordValue(record, 'explanation') as Record<string, unknown> | null });
	return [String(record.id ?? record.assignmentId ?? 'assignment'), String(record.status ?? record.state ?? record.leaseState ?? 'n/a'), `project=${String(record.projectId ?? 'n/a')}`, `provider=${String(record.capacityProviderId ?? record.providerId ?? 'n/a')}`, `execution=${executionLabel(visibility)}`, `adapter=${visibility.adapterStatus ?? 'n/a'}`, `external=${externalLabel(visibility)}`].join(' | ');
}

function summarizeModeRunRecord(record: unknown) {
	if (!isCapacityRecord(record)) return String(record ?? '');
	const visibility = summarizeExecutionProviderVisibility({ modeRun: record });
	return [String(record.id ?? 'mode-run'), String(record.status ?? record.state ?? 'n/a'), `assignment=${String(record.assignmentId ?? 'n/a')}`, `execution=${executionLabel(visibility)}`, `adapter=${visibility.adapterStatus ?? 'n/a'}`, `external=${externalLabel(visibility)}`, `artifacts=${visibility.artifacts.length}`, `usage=${visibility.usage.length}`].join(' | ');
}

export function capacityInspectionLines(records: unknown[], action?: string) {
	if (records.length === 0) return ['No records returned.'];
	if (action === 'assignments') return records.slice(0, 25).map(summarizeAssignmentRecord);
	if (action === 'mode-runs') return records.slice(0, 25).map(summarizeModeRunRecord);
	return records.slice(0, 25).map(summarizeRecord);
}

export function decorateCapacityInspectionRecords(action: string, records: unknown[]) {
	if (action === 'assignments') return records.map((record) => isCapacityRecord(record) ? decorateExecutionProviderVisibility(record, { explanation: record.explanation as Record<string, unknown> | null }) : record);
	if (action === 'mode-runs') return records.map((record) => isCapacityRecord(record) ? decorateExecutionProviderVisibility(record, { modeRun: record }) : record);
	return records;
}
