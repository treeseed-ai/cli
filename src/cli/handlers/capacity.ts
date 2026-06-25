import { resolve } from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
	decorateExecutionProviderVisibility,
	summarizeExecutionProviderVisibility,
	type ExecutionProviderVisibilitySummary,
} from '@treeseed/sdk/agent-capacity';
import { MarketClient, resolveMarketProfile } from '@treeseed/sdk/market-client';
import { collectTreeseedReconcileStatus, destroyTreeseedTargetUnits, planTreeseedReconciliation, reconcileTreeseedTarget, type TreeseedReconcileSelector } from '@treeseed/sdk/reconcile';
import { compileTreeseedDesiredResourceGraph, compileTreeseedDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import type { TreeseedCommandContext, TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';
import { renderWorkdayLogInk } from '../workday-log-ui.js';

const PROVIDER_LIFECYCLE_ACTIONS = new Set(['build', 'up', 'down', 'restart', 'logs', 'status', 'test-local']);
const PROVIDER_ENTRYPOINT_ACTIONS = new Set(['doctor', 'register', 'plan']);
const MARKET_CAPACITY_ACTIONS = new Set(['migrate']);
const MARKET_INSPECTION_ACTIONS = new Set(['allocation-sets', 'agent-classes', 'provider-sessions', 'assignments', 'mode-runs', 'execution-runs', 'workday-log', 'decision-planning', 'execution-inputs', 'capacity-plans', 'capacity-plan', 'workday', 'workday-summary', 'workday-run', 'assignment-explanation', 'fallback-outputs', 'treedx-proxy-audit']);
const CAPACITY_PROVIDER_UNIT_IDS = ['capacity-provider:local', 'local-docker-compose:agent-capacity-provider'];
const CAPACITY_PROVIDER_UNIT_ID_SET = new Set(CAPACITY_PROVIDER_UNIT_IDS);
const WORKDAY_TEST_PROJECT_SLUGS = ['market', 'admin', 'agent', 'api', 'cli', 'core', 'sdk', 'ui', 'treedx'];
const WORKDAY_TEST_AGENT_COUNT = 9;

function safeWorkdayIdPart(value: string) {
	return value.replace(/[^a-zA-Z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 96) || randomUUID();
}

function treeDxRepositoryIdForProjectSlug(slug: string) {
	return `treeseed-${slug}`.toLowerCase().replace(/[^a-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'treeseed-project';
}

type WorkdayTestAgentSpec = {
	id: string;
	slug: string;
	name: string;
	handler: string | null;
	projectAgentClassId: string;
	projectAgentClassSlug: string;
	contentPath: string;
};

function stringArg(invocation: TreeseedParsedInvocation, name: string) {
	const value = invocation.args[name];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, name: string) {
	return invocation.args[name] === true;
}

function booleanArg(invocation: TreeseedParsedInvocation, name: string, fallback = false) {
	const value = invocation.args[name];
	if (value === true) return true;
	if (value === false) return false;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
		if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	}
	return fallback;
}

function numberArg(invocation: TreeseedParsedInvocation, name: string) {
	const value = invocation.args[name];
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) return Number(value);
	return null;
}

function csvArg(invocation: TreeseedParsedInvocation, name: string, fallback: string[]) {
	const value = stringArg(invocation, name);
	if (!value || value === 'all') return fallback;
	const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return entries.length ? [...new Set(entries)] : fallback;
}

function positiveNumberArg(invocation: TreeseedParsedInvocation, name: string, fallback: number) {
	const value = numberArg(invocation, name);
	return value && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function formatNumber(value: unknown, digits = 2) {
	if (value === null || value === undefined || value === '') return 'n/a';
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return String(value);
	return numeric.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function recordValue(record: unknown, key: string) {
	return record && typeof record === 'object' && key in record ? (record as Record<string, unknown>)[key] : undefined;
}

function marketRequest<T>(client: unknown, path: string, options: { method?: string; body?: unknown; requireAuth?: boolean } = {}) {
	return (
		client as {
			request<TResponse>(path: string, options?: { method?: string; body?: unknown; requireAuth?: boolean }): Promise<TResponse>;
		}
	).request<T>(path, options);
}

function providerSelector(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'provider') ?? 'local';
}

function environmentSelector(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'environment') ?? 'local';
}

function capacityProviderUnits<T extends { unitId?: unknown; dependencies?: string[] }>(units: T[]) {
	return units
		.filter((unit) => CAPACITY_PROVIDER_UNIT_ID_SET.has(String(unit.unitId ?? '')))
		.map((unit) => ({
			...unit,
			dependencies: (unit.dependencies ?? []).filter((dependencyId) => CAPACITY_PROVIDER_UNIT_ID_SET.has(dependencyId)),
		}));
}

function resolveMarket(invocation: TreeseedParsedInvocation) {
	return resolveMarketProfile(stringArg(invocation, 'market') ?? 'local');
}

function localAcceptanceAdminToken(env: NodeJS.ProcessEnv) {
	const configured = env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN?.trim();
	return configured || 'tsk_local_treeseed_acceptance_admin';
}

function createWorkdayTestMarketClient(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const profile = resolveMarket(invocation);
	if (profile.id === 'local') {
		return {
			profile,
			authMode: 'local_acceptance_admin',
			client: new MarketClient({
				profile,
				accessToken: localAcceptanceAdminToken(context.env),
				fetchImpl: fetch,
				userAgent: 'treeseed-cli',
			}),
		};
	}
	try {
		return {
			...createMarketClientForInvocation(invocation, context, { requireAuth: true }),
			authMode: 'session',
		};
	} catch (error) {
		throw error;
	}
}

function resolveCapacityLaunchConfigPath(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const configPath = stringArg(invocation, 'config');
	if (!configPath) return null;
	return resolve(context.cwd, configPath);
}

function isNonGitWorkspaceError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return /not a git repository/u.test(message);
}

function nativeBudgetSummaryLines(report: Record<string, unknown> | null) {
	const budgets = recordValue(report, 'budgets');
	const nativeCapacity = recordValue(budgets, 'nativeCapacity') ?? recordValue(budgets, 'native_capacity');
	const executionProviders = recordValue(nativeCapacity, 'executionProviders') ?? recordValue(nativeCapacity, 'execution_providers');
	if (!Array.isArray(executionProviders)) return [];
	return executionProviders.flatMap((provider) => {
		const name = recordValue(provider, 'name') ?? recordValue(provider, 'id') ?? 'execution provider';
		const kind = recordValue(provider, 'kind') ?? 'custom';
		const nativeUnit = recordValue(provider, 'nativeUnit') ?? recordValue(provider, 'native_unit') ?? 'native unit';
		const workers = recordValue(provider, 'maxConcurrentWorkers') ?? recordValue(provider, 'max_concurrent_workers');
		const limits = recordValue(provider, 'nativeLimits') ?? recordValue(provider, 'native_limits');
		const lines = [`${name}: ${kind}, ${nativeUnit}${workers ? `, workers ${workers}` : ''}`];
		if (Array.isArray(limits)) {
			for (const limit of limits) {
				lines.push(`  ${recordValue(limit, 'scope') ?? recordValue(limit, 'limitScope') ?? 'limit'}: ${formatNumber(recordValue(limit, 'limitAmount') ?? recordValue(limit, 'limit_amount'))} ${recordValue(limit, 'nativeUnit') ?? nativeUnit}, reserve ${formatNumber(recordValue(limit, 'reserveBufferPercent') ?? recordValue(limit, 'reserve_buffer_percent'))}%`);
			}
		}
		return lines;
	});
}

function derivedCapacityLines(plan: Record<string, unknown>) {
	const derivedCapacity = recordValue(plan, 'derivedCapacity');
	const entries = recordValue(derivedCapacity, 'entries');
	if (!Array.isArray(entries) || entries.length === 0) {
		return ['No derived native capacity entries are available yet.'];
	}
	return entries.map((entry) => [`${recordValue(entry, 'executionProviderKind') ?? 'provider'}:${recordValue(entry, 'nativeUnit') ?? 'native'}`, `limit ${formatNumber(recordValue(entry, 'configuredNativeLimit'))}`, `observed ${formatNumber(recordValue(entry, 'observedNativeRemaining'))}`, `reserved ${formatNumber(recordValue(entry, 'activeReservedNativeAmount'))}`, `reserve ${formatNumber(recordValue(entry, 'reserveBufferPercent'))}%`, `conversion ${formatNumber(recordValue(entry, 'nativeUnitsPerCredit'))} native/credit`, `derived ${formatNumber(recordValue(entry, 'derivedAvailableCredits'))} credits`, `confidence ${recordValue(entry, 'confidence') ?? 'unknown'}`].join(' | '));
}

function summarizeRecord(record: unknown) {
	if (!record || typeof record !== 'object') return String(record ?? '');
	const item = record as Record<string, unknown>;
	const id = String(item.id ?? item.assignmentId ?? item.sessionId ?? item.classId ?? 'record');
	const state = item.status ?? item.state ?? item.leaseState ?? item.mode ?? item.kind ?? null;
	const parts = [id, state ? String(state) : null, item.projectId ? `project=${String(item.projectId)}` : null, item.providerId ? `provider=${String(item.providerId)}` : null, item.mode ? `mode=${String(item.mode)}` : null, item.updatedAt ? `updated=${String(item.updatedAt)}` : item.createdAt ? `created=${String(item.createdAt)}` : null].filter(Boolean);
	return parts.join(' | ');
}

function executionLabel(visibility: ExecutionProviderVisibilitySummary) {
	return visibility.executionProviderKind ?? visibility.executionProviderId ?? 'none';
}

function externalLabel(visibility: ExecutionProviderVisibilitySummary) {
	return visibility.externalRef ?? 'none';
}

function summarizeAssignmentRecord(record: unknown) {
	if (!record || typeof record !== 'object') return String(record ?? '');
	const item = record as Record<string, unknown>;
	const visibility = summarizeExecutionProviderVisibility({
		assignment: item,
		explanation: recordValue(item, 'explanation') as Record<string, unknown> | null,
	});
	return [
		String(item.id ?? item.assignmentId ?? 'assignment'),
		String(item.status ?? item.state ?? item.leaseState ?? 'n/a'),
		`project=${String(item.projectId ?? 'n/a')}`,
		`provider=${String(item.capacityProviderId ?? item.providerId ?? 'n/a')}`,
		`execution=${executionLabel(visibility)}`,
		`adapter=${visibility.adapterStatus ?? 'n/a'}`,
		`external=${externalLabel(visibility)}`,
	].join(' | ');
}

function summarizeModeRunRecord(record: unknown) {
	if (!record || typeof record !== 'object') return String(record ?? '');
	const item = record as Record<string, unknown>;
	const visibility = summarizeExecutionProviderVisibility({ modeRun: item });
	return [
		String(item.id ?? 'mode-run'),
		String(item.status ?? item.state ?? 'n/a'),
		`assignment=${String(item.assignmentId ?? 'n/a')}`,
		`execution=${executionLabel(visibility)}`,
		`adapter=${visibility.adapterStatus ?? 'n/a'}`,
		`external=${externalLabel(visibility)}`,
		`artifacts=${visibility.artifacts.length}`,
		`usage=${visibility.usage.length}`,
	].join(' | ');
}

function listLines(records: unknown[], action?: string) {
	if (records.length === 0) return ['No records returned.'];
	if (action === 'assignments') return records.slice(0, 25).map(summarizeAssignmentRecord);
	if (action === 'mode-runs') return records.slice(0, 25).map(summarizeModeRunRecord);
	return records.slice(0, 25).map(summarizeRecord);
}

function decorateInspectionRecords(action: string, records: unknown[]) {
	if (action === 'assignments') {
		return records.map((record) => isRecord(record)
			? decorateExecutionProviderVisibility(record, { explanation: record.explanation as Record<string, unknown> | null })
			: record);
	}
	if (action === 'mode-runs') {
		return records.map((record) => isRecord(record)
			? decorateExecutionProviderVisibility(record, { modeRun: record })
			: record);
	}
	return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function executionCapabilityMatch(visibility: ExecutionProviderVisibilitySummary) {
	return {
		requiredCapabilities: visibility.requiredCapabilities,
		preferredCapabilities: visibility.preferredCapabilities,
		availableCapabilities: visibility.availableCapabilities,
		aliasCapabilities: visibility.aliasCapabilities,
		missingCapabilities: visibility.missingCapabilities,
		selectedProvider: visibility.selectedProvider,
		selectedExecutionProvider: visibility.selectedExecutionProvider,
		executionProviderKind: visibility.executionProviderKind,
		eligible: visibility.capabilityEligible,
		reasonCodes: visibility.reasonCodes,
	};
}

function capabilityMatchLines(visibility: ExecutionProviderVisibilitySummary) {
	const match = executionCapabilityMatch(visibility);
	return [
		`required: ${match.requiredCapabilities.join(', ') || 'none'}`,
		`available: ${match.availableCapabilities.join(', ') || 'none'}`,
		`aliases: ${match.aliasCapabilities.join(', ') || 'none'}`,
		`missing: ${match.missingCapabilities.join(', ') || 'none'}`,
		`selected provider: ${match.selectedProvider ?? 'none'}`,
		`selected execution provider: ${match.selectedExecutionProvider ?? 'none'}`,
		`execution provider kind: ${match.executionProviderKind ?? 'none'}`,
		`eligible: ${match.eligible === null ? 'unknown' : String(match.eligible)}`,
		`reasons: ${match.reasonCodes.join(', ') || 'none'}`,
	];
}

function queryFromFilters(filters: Record<string, string | number | null>) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value) query.set(key, String(value));
	}
	return query.toString() ? `?${query.toString()}` : '';
}

function modeRunContentArtifacts(modeRun: unknown) {
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

function assignmentContentArtifacts(assignment: unknown) {
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

function uniqueContentArtifacts(artifacts: unknown[]) {
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

function normalizeExecutionRunRecord(row: Record<string, unknown>) {
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

function dedupeExecutionRunRecords(rows: Record<string, unknown>[]) {
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

function groupWorkdayExecutionRecords(rows: Record<string, unknown>[]) {
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

function dedupeModeRunRecords(rows: unknown[]) {
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

function workdayRowRecord(row: Record<string, unknown>, key: string) {
	const value = recordValue(row, key);
	return isRecord(value) ? value : {};
}

function modeRunOutputs(modeRun: Record<string, unknown>) {
	const outputs = recordValue(modeRun, 'outputs');
	return isRecord(outputs) ? outputs : {};
}

function modeRunMetadata(modeRun: Record<string, unknown>) {
	const metadata = recordValue(modeRunOutputs(modeRun), 'metadata');
	return isRecord(metadata) ? metadata : {};
}

function modeRunSource(modeRun: Record<string, unknown>) {
	return String(recordValue(modeRun, 'source') ?? recordValue(modeRunMetadata(modeRun), 'source') ?? '').trim();
}

function firstModeRunBySource(modeRuns: Record<string, unknown>[], source: string) {
	return modeRuns.find((modeRun) => modeRunSource(modeRun) === source);
}

function lastModeRunBySource(modeRuns: Record<string, unknown>[], source: string) {
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

function contextFromWorkPackage(workPackage: Record<string, unknown>) {
	const context = recordValue(workPackage, 'context');
	return isRecord(context) ? context : {};
}

function contextDiagnosticsFromWorkPackage(workPackage: Record<string, unknown>) {
	const context = contextFromWorkPackage(workPackage);
	const diagnostics = recordValue(context, 'contextDiagnostics') ?? recordValue(workPackage, 'contextDiagnostics');
	return isRecord(diagnostics) ? diagnostics : {};
}

function contextPackSummaries(workPackage: Record<string, unknown>) {
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

function workdaySummaryFacts(row: Record<string, unknown>) {
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

function workdayTimelineBlock(row: Record<string, unknown>) {
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

async function executionRunsForAssignments(client: unknown, teamId: string, assignmentIds: string[]) {
	const rows = await Promise.all(assignmentIds.map(async (assignmentId) => {
		const response = await marketRequest<{ ok: true; payload: unknown[] }>(
			client,
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/execution-runs${queryFromFilters({ assignmentId, limit: 50 })}`,
			{ requireAuth: true },
		).catch(() => ({ ok: false, payload: [] as unknown[] }));
		return Array.isArray(response.payload) ? response.payload.filter(isRecord) : [];
	}));
	return dedupeExecutionRunRecords(rows.flat().map((row) => normalizeExecutionRunRecord(redactAuditValue(row) as Record<string, unknown>)));
}

async function workdayAssignmentIdsForLog(client: unknown, teamId: string, workdayId: string, providerId: string | null) {
	const response = await marketRequest<{ ok: true; payload: unknown[] }>(
		client,
		`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments${queryFromFilters({ providerId })}`,
		{ requireAuth: true },
	).catch(() => ({ ok: false, payload: [] as unknown[] }));
	return (Array.isArray(response.payload) ? response.payload : [])
		.filter(isRecord)
		.filter((assignment) => String(recordValue(assignment, 'workDayId') ?? recordValue(assignment, 'workdayId') ?? '') === workdayId)
		.sort((a, b) => {
			const aTime = timestampMs(recordValue(a, 'assignedAt') ?? recordValue(a, 'createdAt')) ?? 0;
			const bTime = timestampMs(recordValue(b, 'assignedAt') ?? recordValue(b, 'createdAt')) ?? 0;
			return aTime - bTime;
		})
		.map((assignment) => String(recordValue(assignment, 'id') ?? '').trim())
		.filter(Boolean);
}

async function enrichWorkdayLogRecordsWithModeRuns(client: unknown, rows: Record<string, unknown>[]) {
	return Promise.all(rows.map(async (row) => {
		const agent = recordValue(row, 'agent');
		const assignment = recordValue(row, 'assignment');
		const projectId = String(recordValue(agent, 'projectId') ?? '').trim();
		const assignmentId = String(recordValue(assignment, 'id') ?? '').trim();
		if (!projectId || !assignmentId) {
			return { ...row, modeRuns: [] };
		}
		const response = await (
			client as {
				projectAgentModeRuns(projectId: string, options?: { mode?: string | null; assignmentId?: string | null }): Promise<{ payload?: unknown[] }>;
			}
		).projectAgentModeRuns(projectId, { assignmentId }).catch(() => ({ payload: [] as unknown[] }));
		const modeRuns = Array.isArray(response.payload)
			? response.payload
				.map((entry) => redactAuditValue(entry) as Record<string, unknown>)
				.filter(isRecord)
				.sort((a, b) => {
					const aTime = timestampMs(recordValue(a, 'createdAt') ?? recordValue(recordValue(a, 'timing'), 'createdAt')) ?? 0;
					const bTime = timestampMs(recordValue(b, 'createdAt') ?? recordValue(recordValue(b, 'timing'), 'createdAt')) ?? 0;
					return aTime - bTime;
				})
			: [];
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

function workdayLogDetailLines(rows: Record<string, unknown>[], maxRecords = 6) {
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

function isTerminalAssignment(assignment: unknown) {
	const status = String(recordValue(assignment, 'status') ?? '').toLowerCase();
	const leaseState = String(recordValue(assignment, 'leaseState') ?? '').toLowerCase();
	if (['completed', 'failed', 'returned', 'expired', 'cancelled'].includes(status)) return true;
	return status === 'completed' && leaseState === 'released';
}

function isUnfinishedAssignment(assignment: unknown) {
	return !isTerminalAssignment(assignment);
}

async function fetchWorkdayTestAssignments(
	client: unknown,
	teamId: string,
	projectStates: Array<{ projectId: string; assignmentIds: string[] }>,
	providerId: string,
	runId: string,
) {
	const entries = await Promise.all(projectStates.map(async (projectState) => {
		const response = await (
			client as {
				providerAssignments(teamId: string, options?: { projectId?: string | null; providerId?: string | null }): Promise<{ payload?: unknown[] }>;
			}
		).providerAssignments(teamId, { projectId: projectState.projectId, providerId }).catch(() => ({ payload: [] as unknown[] }));
		const assignments = (Array.isArray(response.payload) ? response.payload : [])
			.filter(isRecord)
			.filter((assignment) => {
				const assignmentId = String(assignment.id ?? '');
				const metadata = recordValue(assignment, 'metadata');
				const explanation = recordValue(assignment, 'explanation');
				const synthesisKey = String(recordValue(assignment, 'synthesisKey') ?? '');
				return projectState.assignmentIds.includes(assignmentId)
					|| metadata.workdayTestRunId === runId
					|| explanation.runId === runId
					|| synthesisKey.startsWith(`${runId}:`);
			});
		return [projectState.projectId, assignments] as const;
	}));
	return new Map(entries);
}

async function waitForWorkdayTestAssignments(
	client: unknown,
	teamId: string,
	projectStates: Array<{ projectId: string; assignmentIds: string[] }>,
	providerId: string,
	waitSeconds: number,
	runId: string,
) {
	const deadline = Date.now() + waitSeconds * 1000;
	let snapshots = await fetchWorkdayTestAssignments(client, teamId, projectStates, providerId, runId);
	while (Date.now() < deadline) {
		const unfinished = [...snapshots.values()].flat().filter(isUnfinishedAssignment);
		if (unfinished.length === 0) {
			return { completed: true, snapshots, unfinished };
		}
		await sleep(Math.min(5000, Math.max(500, deadline - Date.now())));
		snapshots = await fetchWorkdayTestAssignments(client, teamId, projectStates, providerId, runId);
	}
	const unfinished = [...snapshots.values()].flat().filter(isUnfinishedAssignment);
	return { completed: unfinished.length === 0, snapshots, unfinished };
}

async function holdWorkdayOpen(input: {
	runId: string;
	durationSeconds: number;
	event(body: Record<string, unknown>): Promise<void>;
}) {
	const durationMs = Math.max(0, Math.floor(input.durationSeconds * 1000));
	const startedAt = new Date().toISOString();
	const deadline = Date.now() + durationMs;
	const deadlineAt = new Date(deadline).toISOString();
	await input.event({
		eventType: 'workday.duration.started',
		status: 'recorded',
		title: `Timed workday observation started for ${input.durationSeconds}s`,
		context: { durationSeconds: input.durationSeconds, startedAt, deadlineAt },
	});
	while (Date.now() < deadline) {
		await sleep(Math.min(15_000, Math.max(250, deadline - Date.now())));
	}
	const completedAt = new Date().toISOString();
	await input.event({
		eventType: 'workday.duration.completed',
		status: 'recorded',
		title: 'Timed workday observation completed',
		context: { durationSeconds: input.durationSeconds, startedAt, deadlineAt, completedAt },
	});
	return { startedAt, deadlineAt, completedAt };
}

function redactAuditValue(value: unknown, key = ''): unknown {
	if (/(api[_-]?key|authorization|bearer|credential|lease[_-]?token|password|secret|token)$/iu.test(key)) {
		return '<redacted>';
	}
	if (Array.isArray(value)) return value.map((entry) => redactAuditValue(entry));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
		entryKey,
		redactAuditValue(entryValue, entryKey),
	]));
}

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

function timestampMs(value: unknown) {
	if (typeof value !== 'string' || !value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function durationMs(start: unknown, end: unknown) {
	const started = timestampMs(start);
	const ended = timestampMs(end);
	if (started === null || ended === null || ended < started) return null;
	return ended - started;
}

function nestedNumber(value: unknown, keys: string[]): number | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	for (const key of keys) {
		const direct = record[key];
		if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
		if (typeof direct === 'string' && Number.isFinite(Number(direct))) return Number(direct);
	}
	for (const entry of Object.values(record)) {
		const nested = nestedNumber(entry, keys);
		if (nested !== null) return nested;
	}
	return null;
}

function tokenDiagnostics(...sources: unknown[]) {
	const source = sources.find((entry) => entry && typeof entry === 'object') ?? {};
	return {
		promptTokens: nestedNumber(source, ['promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens']),
		completionTokens: nestedNumber(source, ['completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens']),
		totalTokens: nestedNumber(source, ['totalTokens', 'total_tokens', 'tokens']),
		cachedTokens: nestedNumber(source, ['cachedTokens', 'cached_tokens', 'cachedInputTokens', 'cached_input_tokens']),
		reasoningTokens: nestedNumber(source, ['reasoningTokens', 'reasoning_tokens']),
	};
}

async function resolveWorkdayTestTeam(client: unknown, teamSelector: string) {
	const profile = await marketRequest<{ ok: boolean; payload?: Record<string, unknown> }>(
		client,
		`/v1/teams/by-name/${encodeURIComponent(teamSelector)}/profile`,
		{ requireAuth: true },
	).catch(() => null);
	const payload = profile?.payload && typeof profile.payload === 'object' ? profile.payload : {};
	const team = recordValue(payload, 'team');
	if (team && typeof team === 'object') {
		const teamRecord = team as Record<string, unknown>;
		const activity = recordValue(payload, 'activity');
		const projects = activity && typeof activity === 'object' && Array.isArray((activity as Record<string, unknown>).projects)
			? (activity as Record<string, unknown>).projects as Array<Record<string, unknown>>
			: [];
		return {
			teamId: String(teamRecord.id ?? teamSelector),
			teamSelector,
			team,
			projects,
		};
	}
	return {
		teamId: teamSelector,
		teamSelector,
		team: null,
		projects: [] as Array<Record<string, unknown>>,
	};
}

async function runExecutionRunsInspection(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext, options: { action?: 'execution-runs' | 'workday-log' } = {}) {
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
	const rawLimit = action === 'workday-log' ? Math.max(maxRuns * 100, maxRuns) : maxRuns;
	const { profile, client, authMode } = createWorkdayTestMarketClient(invocation, context);
	const team = await resolveWorkdayTestTeam(client, teamSelector);
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
		: await marketRequest<{ ok: true; payload: unknown[] }>(
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
	const rows = (Array.isArray(response.payload) ? response.payload : [])
		.filter(isRecord)
		.filter((row) => !kindFilter || String(recordValue(recordValue(row, 'executionProvider'), 'id') ?? '').toLowerCase().includes(kindFilter.toLowerCase()))
		.map((row) => normalizeExecutionRunRecord(redactAuditValue(row) as Record<string, unknown>));
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

function workdayTestScore(input: {
	expectedProjects: string[];
	actualProjects: Array<Record<string, unknown>>;
	providerReady: boolean;
	auditEvents: number;
	planningOnly: boolean;
}) {
	const bySlug = new Map(input.actualProjects.map((project) => [String(project.slug ?? project.projectId), project]));
	const expected = input.expectedProjects;
	const projectCoverage = expected.filter((slug) => bySlug.has(slug)).length;
	const agentCoverage = expected.filter((slug) => Number(bySlug.get(slug)?.agentCount ?? 0) >= WORKDAY_TEST_AGENT_COUNT).length;
	const expectedPlanningRunsForProject = (project: Record<string, unknown> | undefined) => Math.min(
		WORKDAY_TEST_AGENT_COUNT,
		Number(project?.agentCount ?? WORKDAY_TEST_AGENT_COUNT),
	);
	const planningCoverage = expected.filter((slug) => {
		const project = bySlug.get(slug);
		return Number(project?.planningRuns ?? 0) >= expectedPlanningRunsForProject(project);
	}).length;
	const contentCoverage = expected.filter((slug) => Number(bySlug.get(slug)?.contentArtifacts ?? 0) > 0).length;
	const actingExpected = input.planningOnly
		? 0
		: expected.filter((slug) => Number(bySlug.get(slug)?.actingAssignments ?? 0) > 0).length;
	const actingCoverage = actingExpected === 0
		? 0
		: expected.filter((slug) => Number(bySlug.get(slug)?.actingRuns ?? 0) > 0 || Number(bySlug.get(slug)?.outputs ?? 0) > 0).length;
	const checks = [
		{ name: 'projectCoverage', actual: projectCoverage, expected: expected.length },
		{ name: 'agentCoverage', actual: agentCoverage, expected: expected.length },
		{ name: 'planningCoverage', actual: planningCoverage, expected: expected.length },
		{ name: 'contentArtifactCoverage', actual: contentCoverage, expected: expected.length },
		{ name: 'actingCoverage', actual: actingCoverage, expected: actingExpected },
		{ name: 'auditCompleteness', actual: input.auditEvents > 0 ? 1 : 0, expected: 1 },
		{ name: 'providerHealth', actual: input.providerReady ? 1 : 0, expected: 1 },
	].map((check) => ({
		...check,
		score: check.expected === 0 ? 100 : Math.round(Math.max(0, Math.min(1, check.actual / check.expected)) * 100),
	}));
	const blockers = [
		...(input.providerReady ? [] : ['local provider readiness was not proven']),
		...(input.auditEvents > 0 ? [] : ['audit event trail is empty']),
		...input.actualProjects.flatMap((project) => Array.isArray(project.blockers) ? (project.blockers as unknown[]).map((blocker) => `${project.slug}: ${String(blocker)}`) : []),
	];
	const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
	return {
		score,
		status: blockers.length === 0 && score >= 90 ? 'completed' : score >= 60 ? 'degraded' : 'failed',
		checks,
		blockers,
	};
}

async function writeWorkdayRunReportFiles(context: TreeseedCommandContext, input: {
	runId: string;
	reportDir: string;
	parameters: Record<string, unknown>;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	metrics: Record<string, unknown>;
}) {
	const reportDir = resolve(context.cwd, input.reportDir);
	await mkdir(reportDir, { recursive: true });
	const jsonPath = resolve(reportDir, `workday-${input.runId}.json`);
	const markdownPath = resolve(reportDir, `workday-${input.runId}.md`);
	await writeFile(jsonPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');
	const checks = Array.isArray(input.metrics.checks) ? input.metrics.checks as Array<Record<string, unknown>> : [];
	const blockers = Array.isArray(input.metrics.blockers) ? input.metrics.blockers as unknown[] : [];
	const actualProjects = Array.isArray(input.actual.projects) ? input.actual.projects as Array<Record<string, unknown>> : [];
	const diagnosticLines = actualProjects.flatMap((project) => {
		const diagnostics = Array.isArray(project.leaseDiagnostics) ? project.leaseDiagnostics as Array<Record<string, unknown>> : [];
		return diagnostics.map((diagnostic) => {
			const reasons = Array.isArray(diagnostic.reasons) ? diagnostic.reasons.join(', ') : String(diagnostic.reasons ?? 'unknown');
			return `- ${String(project.slug ?? project.projectId)} / ${String(diagnostic.assignmentId ?? 'assignment')}: ${reasons || 'no recorded reasons'}`;
		});
	});
	await writeFile(markdownPath, `${[
		`# Workday ${input.runId}`,
		'',
		`Status: ${String(input.metrics.status ?? 'unknown')}`,
		`Score: ${String(input.metrics.score ?? 'n/a')}`,
		`Purpose: ${String(input.parameters.purpose ?? 'portfolio planning')}`,
		`Provider: ${String(input.parameters.providerId ?? 'local')}`,
		'',
		'## Coverage',
		'',
		...checks.map((check) => `- ${String(check.name)}: ${String(check.actual)}/${String(check.expected)} (${String(check.score)})`),
		'',
		'## Projects',
		'',
		...actualProjects.map((project) => `- ${String(project.slug ?? project.projectId)}: ${String(project.status ?? 'unknown')}; agents=${String(project.agentCount ?? 0)}; planning=${String(project.planningRuns ?? 0)}; acting=${String(project.actingRuns ?? 0)}; assignments=${String(project.assignments ?? 0)}`),
		'',
		'## Blockers',
		'',
		...(blockers.length ? blockers.map((blocker) => `- ${String(blocker)}`) : ['- none']),
		'',
		'## Lease Diagnostics',
		'',
		...(diagnosticLines.length ? diagnosticLines : ['- none']),
	].join('\n')}\n`, 'utf8');
	return { jsonPath, markdownPath };
}

function frontmatterBlock(source: string) {
	const match = /^---\n([\s\S]*?)\n---/u.exec(source);
	return match?.[1] ?? '';
}

function frontmatterScalar(frontmatter: string, key: string) {
	const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(frontmatter);
	return match?.[1]?.trim().replace(/^['"]|['"]$/gu, '') ?? null;
}

async function readWorkdayTestAgentSpecs(context: TreeseedCommandContext, projectSlug: string): Promise<WorkdayTestAgentSpec[]> {
	const agentDir = projectSlug === 'market'
		? resolve(context.cwd, 'src/content/agents')
		: resolve(context.cwd, 'packages', projectSlug, 'docs/src/content/agents');
	const entries = await readdir(agentDir, { withFileTypes: true }).catch(() => []);
	const specs: WorkdayTestAgentSpec[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
		const contentPath = resolve(agentDir, entry.name);
		const source = await readFile(contentPath, 'utf8').catch(() => '');
		const frontmatter = frontmatterBlock(source);
		const slug = frontmatterScalar(frontmatter, 'slug') ?? entry.name.replace(/\.mdx$/u, '');
		specs.push({
			id: frontmatterScalar(frontmatter, 'id') ?? `agent:${slug}`,
			slug,
			name: frontmatterScalar(frontmatter, 'name') ?? slug,
			handler: frontmatterScalar(frontmatter, 'handler'),
			projectAgentClassId: frontmatterScalar(frontmatter, 'projectAgentClassId') ?? frontmatterScalar(frontmatter, 'agentClassId') ?? 'planning',
			projectAgentClassSlug: frontmatterScalar(frontmatter, 'projectAgentClassSlug') ?? frontmatterScalar(frontmatter, 'agentClassSlug') ?? frontmatterScalar(frontmatter, 'projectAgentClassId') ?? 'planning',
			contentPath,
		});
	}
	return specs.sort((left, right) => left.slug.localeCompare(right.slug));
}

function providerMatchesSelector(provider: Record<string, unknown>, selector: string) {
	const metadata = provider.metadata && typeof provider.metadata === 'object' ? provider.metadata as Record<string, unknown> : {};
	return [provider.id, provider.name, provider.provider, provider.kind, metadata.provider, metadata.localProviderId]
		.some((value) => String(value ?? '').toLowerCase() === selector.toLowerCase());
}

async function resolveWorkdayTestProviderId(client: ReturnType<typeof createMarketClientForInvocation>['client'], teamId: string, selector: string) {
	const providersResponse = await client.teamCapacityProviders(teamId).catch(() => ({ payload: [] as unknown[] }));
	const providers = providersResponse.payload as Array<Record<string, unknown>>;
	const matched = providers.find((provider) => providerMatchesSelector(provider, selector));
	return {
		providerId: String(matched?.id ?? selector),
		providers,
	};
}

async function ensureWorkdayTestAgentClasses(
	client: ReturnType<typeof createMarketClientForInvocation>['client'],
	context: TreeseedCommandContext,
	projectId: string,
	projectSlug: string,
	existingClasses: Array<Record<string, unknown>>,
) {
	const existingByKey = new Map(existingClasses.flatMap((agentClass) => [
		[String(agentClass.id ?? ''), agentClass] as const,
		[String(agentClass.slug ?? ''), agentClass] as const,
	]).filter(([key]) => key.length > 0));
	const created: Array<Record<string, unknown>> = [];
	const specs = await readWorkdayTestAgentSpecs(context, projectSlug);
	for (const classId of [...new Set(specs.map((spec) => spec.projectAgentClassId))]) {
		const classSpecs = specs.filter((spec) => spec.projectAgentClassId === classId);
		const first = classSpecs[0];
		if (!first || existingByKey.has(classId) || existingByKey.has(first.projectAgentClassSlug)) continue;
		const response = await client.createProjectAgentClass(projectId, {
			id: classId,
			slug: first.projectAgentClassSlug,
			name: `${first.projectAgentClassSlug.replace(/[-_]+/gu, ' ')} agents`,
			status: 'active',
			allowedModes: ['planning', 'acting'],
			requiredCapabilities: ['repo_read', 'agent_mode_run'],
			handlerRefs: { agents: classSpecs.map((spec) => ({ slug: spec.slug, handler: spec.handler })) },
			metadata: {
				source: 'live_workday_agent_content',
				agentCount: classSpecs.length,
				agentSlugs: classSpecs.map((spec) => spec.slug),
				contentPaths: classSpecs.map((spec) => spec.contentPath.replace(`${context.cwd}/`, '')),
			},
		}).catch(() => null);
		if (response?.payload) {
			created.push(response.payload);
			existingByKey.set(classId, response.payload);
			existingByKey.set(first.projectAgentClassSlug, response.payload);
		}
	}
	return {
		agentClasses: [...new Map([...existingByKey.values()].map((agentClass) => [String(agentClass.id ?? agentClass.slug), agentClass])).values()],
		created,
		contentAgents: specs,
		contentAgentCount: specs.length,
	};
}

async function ensureLocalTreeDxForWorkdayTest(context: TreeseedCommandContext, projectSlugs: string[]) {
	const target = { kind: 'persistent' as const, scope: 'local' as const };
	const desiredGraph = compileTreeseedDesiredResourceGraph({
		tenantRoot: context.cwd,
		target,
		localContent: 'edit',
	});
	const unitIds = ['local-docker-compose:treedx', 'local-treedx:team-primary'];
	const selector: TreeseedReconcileSelector = {
		environment: 'local',
		unitId: unitIds,
	};
	const selected = new Set(unitIds);
	const units = compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector)
		.filter((unit) => selected.has(unit.unitId))
		.map((unit) => {
			if (unit.unitId !== 'local-treedx:team-primary') return unit;
			const projects = Array.isArray(unit.spec.projects)
				? unit.spec.projects.filter((project) => projectSlugs.includes(String((project as Record<string, unknown>).slug ?? '')))
				: [];
			return {
				...unit,
				spec: {
					...unit.spec,
					projects,
				},
			};
		});
	if (units.length !== unitIds.length) {
		throw new Error(`Local TreeDX readiness expected ${unitIds.length} units but resolved ${units.length}.`);
	}
	const result = await reconcileTreeseedTarget({
		tenantRoot: context.cwd,
		target,
		env: context.env,
		units,
		selector,
		write: (line) => context.write(`[workday-run] ${line}`, 'stderr'),
	});
	const failed = result.results?.filter((entry) => entry.error || entry.verification?.verified === false) ?? [];
	if (failed.length > 0) {
		throw new Error(`Local TreeDX readiness failed for ${failed.map((entry) => entry.unit?.unitId ?? 'unknown').join(', ')}.`);
	}
	const repositoryIdsBySlug: Record<string, string> = {};
	for (const entry of result.results ?? []) {
		const syncedProjects = recordValue(recordValue(entry, 'state'), 'syncedProjects');
		if (!Array.isArray(syncedProjects)) continue;
		for (const project of syncedProjects) {
			const slug = String(recordValue(project, 'project') ?? '');
			const repositoryId = String(recordValue(project, 'repositoryId') ?? '');
			if (slug && repositoryId) repositoryIdsBySlug[slug] = repositoryId;
		}
	}
	return {
		unitIds,
		projectSlugs,
		repositoryIdsBySlug,
		results: result.results?.map((entry) => ({
			unitId: entry.unit?.unitId ?? null,
			action: entry.action,
			verified: entry.verification?.verified ?? null,
			issues: entry.verification?.issues ?? [],
			error: entry.error ?? null,
		})) ?? [],
	};
}

async function runWorkdayRun(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const { profile, client, authMode } = createWorkdayTestMarketClient(invocation, context);
	const teamSelector = stringArg(invocation, 'team');
	if (!teamSelector) return fail('Missing --team. Use `trsd capacity workday-run --team <team-id> --provider local --execute --json`.');
	const teamResolution = await resolveWorkdayTestTeam(client, teamSelector);
	const teamId = teamResolution.teamId;
	const providerSelectorValue = providerSelector(invocation);
	const projectSlugs = csvArg(invocation, 'projects', WORKDAY_TEST_PROJECT_SLUGS);
	const providerResolution = await resolveWorkdayTestProviderId(client, teamId, providerSelectorValue);
	const providerId = providerResolution.providerId;
	const execute = boolArg(invocation, 'execute');
	const durationSeconds = positiveNumberArg(invocation, 'durationSeconds', execute ? 900 : 0);
	const settleSeconds = positiveNumberArg(invocation, 'waitSeconds', execute ? 30 : 0);
	const actingEnabled = booleanArg(invocation, 'acting', false);
	const abortOnDegradation = boolArg(invocation, 'abort');
	const parameters = {
		purpose: stringArg(invocation, 'purpose') ?? stringArg(invocation, 'scenario') ?? 'portfolio planning',
		seed: stringArg(invocation, 'seed') ?? 'treeseed',
		providerId,
		providerSelector: providerSelectorValue,
		projects: projectSlugs,
		workdays: positiveNumberArg(invocation, 'workdays', 1),
		durationSeconds,
		waitSeconds: settleSeconds,
		maxAssignments: positiveNumberArg(invocation, 'maxAssignments', projectSlugs.length * WORKDAY_TEST_AGENT_COUNT * 6),
		maxActiveAssignments: positiveNumberArg(invocation, 'maxActiveAssignments', Math.max(1, Math.min(projectSlugs.length * WORKDAY_TEST_AGENT_COUNT, 9))),
		planningOnly: boolArg(invocation, 'planningOnly') || !actingEnabled,
		abortOnDegradation,
		dryRun: boolArg(invocation, 'dryRun') || !execute,
		reportDir: stringArg(invocation, 'reportDir') ?? '.treeseed/workday-reports',
	};
	const projectsResponse = teamResolution.projects.length > 0
		? { payload: teamResolution.projects }
		: await client.projects(teamId);
	const projects = (projectsResponse.payload as Array<Record<string, unknown>>)
		.filter((project) => projectSlugs.includes(String(project.slug ?? project.id)));
	const unexpectedSeedProjects = (projectsResponse.payload as Array<Record<string, unknown>>)
		.filter((project) => String(project.slug ?? project.id) === 'karyon');
	const localTreeDxRepositoryIds = new Map<string, string>();
	let localTreeDxSetup: Record<string, unknown> | null = null;
	if (!parameters.dryRun && profile.id === 'local') {
		try {
			await Promise.all(projects.map(async (project) => {
				const slug = String(project.slug ?? project.id);
				const library = await client.projectTreeDxLibrary(String(project.id)).catch(() => null);
				const repositoryId = String(recordValue(recordValue(library, 'payload'), 'repositoryId') ?? '').trim();
				if (repositoryId) localTreeDxRepositoryIds.set(slug, repositoryId);
			}));
			if (localTreeDxRepositoryIds.size < projects.length) {
				const missingSlugs = projects
					.map((project) => String(project.slug ?? project.id))
					.filter((slug) => !localTreeDxRepositoryIds.has(slug));
				const localTreeDx = await ensureLocalTreeDxForWorkdayTest(context, missingSlugs);
				for (const [slug, repositoryId] of Object.entries(localTreeDx.repositoryIdsBySlug)) {
					localTreeDxRepositoryIds.set(slug, repositoryId);
				}
				localTreeDxSetup = {
					mode: 'reconciled_missing_bindings',
					missingSlugs,
					...localTreeDx,
				};
			} else {
				localTreeDxSetup = {
					mode: 'reused_existing_project_libraries',
					projectSlugs,
					repositoryIdsBySlug: Object.fromEntries(localTreeDxRepositoryIds),
				};
			}
			await client.updateTeamTreeDx(teamId, {
				id: 'local-primary',
				kind: 'self_hosted',
				provider: 'local',
				name: 'Local TreeDX',
				baseUrl: 'http://127.0.0.1:4000',
				registryUrl: 'http://127.0.0.1:4000',
				status: 'active',
				primary: true,
				metadata: {
					source: 'live_workday',
					environment: 'local',
				},
			}).catch((error) => {
				throw new Error(`Local TreeDX team binding failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return fail(`Local TreeDX readiness failed: ${message}`);
		}
	}
	const projectStates: Array<{
		projectId: string;
		slug: string;
		workdayId: string | null;
		agentClasses: Array<Record<string, unknown>>;
		contentAgents: WorkdayTestAgentSpec[];
		contentAgentCount: number;
		assignmentIds: string[];
		assignmentCount: number;
		blockers: string[];
	}> = [];
	for (const project of projects) {
		const projectId = String(project.id);
		const slug = String(project.slug ?? project.id);
		const agentClassesResponse = await client.projectAgentClasses(projectId).catch(() => ({ payload: [] as unknown[] }));
		const preparedAgents = await ensureWorkdayTestAgentClasses(client, context, projectId, slug, agentClassesResponse.payload as Array<Record<string, unknown>>);
		projectStates.push({
			projectId,
			slug,
			workdayId: safeWorkdayIdPart(`workday-pending-${slug}`),
			agentClasses: preparedAgents.agentClasses,
			contentAgents: preparedAgents.contentAgents,
			contentAgentCount: preparedAgents.contentAgentCount,
			assignmentIds: [],
			assignmentCount: 0,
			blockers: preparedAgents.contentAgentCount < WORKDAY_TEST_AGENT_COUNT ? [`expected ${WORKDAY_TEST_AGENT_COUNT} content agents, found ${preparedAgents.contentAgentCount}`] : [],
		});
	}
	const repositoryIdsBySlug = Object.fromEntries(localTreeDxRepositoryIds);
	const runResponse = await client.createWorkdayRun(teamId, {
		capacityProviderId: providerId,
		scenarioId: parameters.purpose,
		status: parameters.dryRun ? 'planned' : 'running',
		environment: 'local',
		startedAt: parameters.dryRun ? null : new Date().toISOString(),
		parameters: { ...parameters, repositoryIdsBySlug },
		expected: {
			projects: projectSlugs,
			agentCountPerProject: WORKDAY_TEST_AGENT_COUNT,
			planningModeRequired: true,
			actingModeRequired: !parameters.planningOnly,
		},
	});
	const run = runResponse.payload as Record<string, unknown>;
	const runId = String(run.id);
	let eventCount = 0;
	const event = async (body: Record<string, unknown>) => {
		eventCount += 1;
		await client.createWorkdayEvent(teamId, runId, body).catch(() => null);
	};
	await event({
		eventType: 'command.started',
		status: 'recorded',
		title: 'Live workday command started',
		parameters,
		context: {
			cwd: context.cwd,
			market: profile.id,
			teamSelector,
			teamId,
			authMode,
			...(authMode === 'local_acceptance_admin' ? { auth: { mode: authMode, bearerToken: '[redacted]' } } : {}),
		},
	});
	if (localTreeDxSetup) {
		await event({
			eventType: 'treedx.local_ready',
			status: 'recorded',
			title: 'Local TreeDX repositories ready for API-owned workday',
			context: localTreeDxSetup,
		});
	}
	if (unexpectedSeedProjects.length > 0) {
		await event({
			eventType: 'seed.boundary.warning',
			status: 'warning',
			title: 'Unexpected Karyon project found in Treeseed team local state',
			context: { projectIds: unexpectedSeedProjects.map((project) => project.id) },
		});
	}
	const providerSessions = await client.providerAvailabilitySessions(teamId, { providerId }).catch(() => ({ payload: [] as unknown[] }));
	const providerReady = (providerSessions.payload as Array<Record<string, unknown>>).some((session) => ['open', 'active', 'available'].includes(String(session.status ?? session.state ?? '').toLowerCase()));
	const completedDurationWorkdayIds = new Set<string>();
	let durationWindow: { startedAt: string; deadlineAt: string; completedAt: string } | null = null;
	for (const projectState of projectStates) {
		projectState.workdayId = safeWorkdayIdPart(`workday-${runId}-${projectState.slug}`);
	}
	if (!parameters.dryRun && parameters.durationSeconds > 0) {
		durationWindow = await holdWorkdayOpen({
			runId,
			durationSeconds: parameters.durationSeconds,
			event,
		});
	}
	let waitedAssignmentSnapshots: Map<string, Record<string, unknown>[]> | null = null;
	let waitTimedOutAssignmentIds = new Set<string>();
	if (!parameters.dryRun && parameters.waitSeconds > 0) {
		await event({
			eventType: 'provider.wait.started',
			status: 'recorded',
			title: `Waiting up to ${parameters.waitSeconds}s for provider manager and runner lease consumption`,
			context: { waitSeconds: parameters.waitSeconds },
		});
		const waitResult = await waitForWorkdayTestAssignments(client, teamId, projectStates, providerId, parameters.waitSeconds, runId);
		waitedAssignmentSnapshots = waitResult.snapshots;
		waitTimedOutAssignmentIds = new Set(waitResult.unfinished.map((assignment) => String(assignment.id ?? '')).filter(Boolean));
		await event({
			eventType: 'provider.wait.completed',
			status: waitResult.completed ? 'recorded' : 'warning',
			title: waitResult.completed ? 'Provider lease-consumption wait completed' : 'Provider lease-consumption wait timed out before all assignments reached terminal state',
			context: {
				waitSeconds: parameters.waitSeconds,
				completed: waitResult.completed,
				unfinishedAssignments: waitResult.unfinished.map((assignment) => ({
					id: assignment.id ?? null,
					projectId: assignment.projectId ?? null,
					status: assignment.status ?? null,
					leaseState: assignment.leaseState ?? null,
				})),
			},
		});
	}
	if (!parameters.dryRun && durationWindow) {
		for (const projectState of projectStates) {
			if (!projectState.workdayId || completedDurationWorkdayIds.has(projectState.workdayId)) continue;
			await client.completeWorkday(projectState.workdayId).catch((error) => {
				projectState.blockers.push(`timed workday close failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			completedDurationWorkdayIds.add(projectState.workdayId);
			await event({
				eventType: 'workday.duration.closed',
				status: 'recorded',
				projectId: projectState.projectId,
				workdayId: projectState.workdayId,
				title: `Closed timed workday for ${projectState.slug}`,
				context: {
					durationSeconds: parameters.durationSeconds,
					deadlineAt: durationWindow.deadlineAt,
					completedAt: new Date().toISOString(),
					settleWaitSeconds: parameters.waitSeconds,
					reason: 'duration_elapsed_after_settlement_wait',
				},
			});
		}
	}
	const actualProjects: Array<Record<string, unknown>> = [];
	for (const projectState of projectStates) {
		const projectAssignments = waitedAssignmentSnapshots?.get(projectState.projectId)
			?? (await fetchWorkdayTestAssignments(client, teamId, [projectState], providerId, runId)).get(projectState.projectId)
			?? [];
		const projectAssignmentIds = projectAssignments.map((assignment) => String(assignment.id ?? '')).filter(Boolean);
		const actingAssignments = projectAssignments.filter((assignment) => String(recordValue(assignment, 'mode') ?? '').toLowerCase() === 'acting');
		const modeRunResponses = await Promise.all(projectAssignmentIds.map((assignmentId) => (
			client.projectAgentModeRuns(projectState.projectId, { assignmentId }).catch(() => ({ payload: [] as unknown[] }))
		)));
		const projectModeRuns = dedupeModeRunRecords(modeRunResponses.flatMap((response) => Array.isArray(response.payload) ? response.payload : []));
		const planningRuns = projectModeRuns.filter((run) => String(recordValue(run, 'mode') ?? '').toLowerCase() === 'planning');
		const actingRuns = projectModeRuns.filter((run) => String(recordValue(run, 'mode') ?? '').toLowerCase() === 'acting');
		const executionRuns = await executionRunsForAssignments(client, teamId, projectAssignmentIds);
		const pendingAssignments = projectAssignments.filter((assignment) => {
			return isUnfinishedAssignment(assignment);
		});
		const durationBoundedPendingAssignments = durationWindow
			? pendingAssignments.filter((assignment) => {
				const leaseState = String(recordValue(assignment, 'leaseState') ?? '').toLowerCase();
				const status = String(recordValue(assignment, 'status') ?? '').toLowerCase();
				return !['leased', 'running', 'in_progress'].includes(leaseState)
					&& !['leased', 'running', 'in_progress'].includes(status);
			})
			: [];
		const activeUnfinishedAssignments = durationWindow
			? pendingAssignments.filter((assignment) => !durationBoundedPendingAssignments.includes(assignment))
			: pendingAssignments;
		const failedAssignments = projectAssignments.filter((assignment) => {
			const status = String(recordValue(assignment, 'status') ?? '').toLowerCase();
			const lifecycleCode = String(recordValue(assignment, 'lifecycleCode') ?? '').trim();
			if (['failed', 'returned', 'expired', 'cancelled'].includes(status)) return true;
			return Boolean(lifecycleCode) && !['completed', 'succeeded', 'success'].includes(status);
		});
		const leaseDiagnostics = (await Promise.all(pendingAssignments.map(async (assignment) => {
			const assignmentId = String(assignment.id ?? '');
			if (!assignmentId) return null;
			const explanation = await client.providerAssignmentExplanation(teamId, assignmentId).catch(() => null);
			const payload = explanation && typeof explanation === 'object' && 'payload' in explanation
				? (explanation as { payload?: unknown }).payload
				: explanation;
			return payload && typeof payload === 'object'
				? {
					assignmentId,
					status: assignment.status ?? null,
					leaseState: assignment.leaseState ?? null,
					reasons: recordValue(payload, 'reasons') ?? [],
					gates: recordValue(payload, 'gates') ?? {},
					metadata: recordValue(payload, 'metadata') ?? {},
				}
				: {
					assignmentId,
					status: assignment.status ?? null,
					leaseState: assignment.leaseState ?? null,
					reasons: ['lease_diagnostics_missing'],
					gates: {},
					metadata: {},
				};
		}))).filter(Boolean);
		if (activeUnfinishedAssignments.length > 0 && leaseDiagnostics.length === 0) {
			projectState.blockers.push(`${activeUnfinishedAssignments.length} active assignment(s) remained unfinished without lease diagnostics`);
		} else if (activeUnfinishedAssignments.length > 0) {
			const reasons = leaseDiagnostics.flatMap((diagnostic) => Array.isArray((diagnostic as Record<string, unknown>).reasons)
				? ((diagnostic as Record<string, unknown>).reasons as unknown[]).map(String)
				: []);
			const timedOutCount = activeUnfinishedAssignments.filter((assignment) => waitTimedOutAssignmentIds.has(String(assignment.id ?? ''))).length;
			projectState.blockers.push(`${activeUnfinishedAssignments.length} active assignment(s) remained unfinished${timedOutCount > 0 ? ` after ${parameters.waitSeconds}s` : ''}${reasons.length ? `: ${[...new Set(reasons)].join(', ')}` : ''}`);
		}
		const contentArtifacts = uniqueContentArtifacts([
			...projectAssignments.flatMap(assignmentContentArtifacts),
			...projectModeRuns.flatMap(modeRunContentArtifacts),
			...executionRuns.flatMap(modeRunContentArtifacts),
		]);
		const expectedPlanningRuns = Math.min(WORKDAY_TEST_AGENT_COUNT, projectState.contentAgentCount);
		if (projectState.contentAgentCount < WORKDAY_TEST_AGENT_COUNT) projectState.blockers.push(`expected ${WORKDAY_TEST_AGENT_COUNT} content agents, found ${projectState.contentAgentCount}`);
		if (!parameters.dryRun && expectedPlanningRuns > 0 && planningRuns.length < expectedPlanningRuns) {
			projectState.blockers.push(`planning portfolio incomplete: expected at least ${expectedPlanningRuns} planning run(s), observed ${planningRuns.length}`);
		}
		if (!parameters.dryRun && durationWindow && projectAssignmentIds.length > 0 && planningRuns.length === 0) {
			projectState.blockers.push('timed workday elapsed without any planning mode run telemetry');
		}
		if (!parameters.dryRun && projectAssignmentIds.length > 0 && projectModeRuns.length === 0) {
			projectState.blockers.push('created assignments did not produce assignment-scoped mode-run telemetry');
		}
		if (!parameters.dryRun && projectAssignments.length === 0) {
			projectState.blockers.push('API workday scheduling did not synthesize any provider assignments during the timed workday window');
		}
		if (!parameters.dryRun && projectAssignments.length > 0 && planningRuns.length === 0) {
			projectState.blockers.push('provider assignments did not produce planning mode runs');
		}
		if (!parameters.dryRun && projectModeRuns.length > 0 && executionRuns.length === 0) {
			projectState.blockers.push('mode runs did not appear in the execution-run audit projection');
		}
		if (!parameters.dryRun && failedAssignments.length > 0) {
			const reasons = failedAssignments.map((assignment) => {
				const id = String(recordValue(assignment, 'id') ?? 'assignment');
				const status = String(recordValue(assignment, 'status') ?? 'failed');
				const code = String(recordValue(assignment, 'lifecycleCode') ?? '').trim();
				const reason = String(recordValue(assignment, 'lifecycleReason') ?? '').trim();
				return [id, status, code || null, reason || null].filter(Boolean).join(' | ');
			});
			projectState.blockers.push(`terminal assignment failure: ${reasons.join('; ')}`);
		}
		if (!parameters.dryRun && projectAssignmentIds.length > 0 && contentArtifacts.length === 0) {
			projectState.blockers.push('completed workday did not produce durable content artifact refs');
		}
		const badTestArtifacts = contentArtifacts
			.map((artifact) => String(recordValue(artifact, 'contentPath') ?? ''))
			.filter((contentPath) => contentPath.split('/').some((part) => part.startsWith('workday-') && part.endsWith('tests')));
		if (badTestArtifacts.length > 0) {
			projectState.blockers.push(`agent content used non-production namespace: ${badTestArtifacts.join(', ')}`);
		}
		actualProjects.push({
			projectId: projectState.projectId,
			slug: projectState.slug,
			workdayId: projectState.workdayId,
			agentCount: projectState.contentAgentCount,
			agentClassCount: projectState.agentClasses.length,
			assignments: Math.max(projectState.assignmentCount, projectAssignments.length),
			actingAssignments: actingAssignments.length,
			pendingAssignments: pendingAssignments.length,
			durationBoundedPendingAssignments: durationBoundedPendingAssignments.length,
			activeUnfinishedAssignments: activeUnfinishedAssignments.length,
			durationWindow,
			leaseDiagnostics,
			planningRuns: planningRuns.length,
			actingRuns: actingRuns.length,
			executionRuns: executionRuns.length,
			executionRunRefs: executionRuns.map((run) => ({
				id: recordValue(run, 'id') ?? null,
				status: recordValue(run, 'status') ?? null,
				timing: recordValue(run, 'timing') ?? {},
				agent: recordValue(run, 'agent') ?? {},
				assignment: recordValue(run, 'assignment') ?? {},
				executionProvider: recordValue(run, 'executionProvider') ?? {},
				contentArtifactRefs: uniqueContentArtifacts(Array.isArray(recordValue(run, 'contentArtifactRefs')) ? recordValue(run, 'contentArtifactRefs') as unknown[] : []),
			})),
			contentArtifacts: contentArtifacts.length,
			contentArtifactRefs: contentArtifacts,
			status: projectState.blockers.length ? 'degraded' : 'ready',
			blockers: projectState.blockers,
		});
		if (projectState.workdayId && !parameters.dryRun) {
			if (!completedDurationWorkdayIds.has(projectState.workdayId)) {
			await client.completeWorkday(projectState.workdayId).catch(() => null);
			await event({
				eventType: 'workday.completed',
				projectId: projectState.projectId,
				workdayId: projectState.workdayId,
				title: `Completed workday for ${projectState.slug}`,
			});
		}
	}
	}
	const metrics = workdayTestScore({
		expectedProjects: projectSlugs,
		actualProjects,
		providerReady,
		auditEvents: eventCount,
		planningOnly: parameters.planningOnly,
	});
	const reportRefs = await writeWorkdayRunReportFiles(context, {
		runId,
		reportDir: parameters.reportDir,
		parameters,
		expected: { projects: projectSlugs, agentCountPerProject: WORKDAY_TEST_AGENT_COUNT },
		actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
		metrics,
	});
	await client.updateWorkdayRun(teamId, runId, {
		status: metrics.status,
		completedAt: new Date().toISOString(),
		summary: {
			score: metrics.score,
			status: metrics.status,
			projectCount: actualProjects.length,
			blockerCount: metrics.blockers.length,
		},
		metrics,
		actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
		reportRefs,
		error: metrics.status === 'failed' ? { blockers: metrics.blockers } : {},
	});
	const abortFailure = parameters.abortOnDegradation && metrics.status !== 'completed';
	await event({
		eventType: abortFailure ? 'command.aborted' : 'command.completed',
		status: abortFailure ? 'failed' : metrics.status,
		title: abortFailure ? 'Workday aborted after degradation' : 'Workday command completed',
		refs: reportRefs,
		context: abortFailure ? { blockers: metrics.blockers, score: metrics.score } : {},
	});
	return guidedResult({
		command: 'capacity workday-run',
		summary: abortFailure
			? `Workday ${runId} aborted after status ${metrics.status} and score ${metrics.score}.`
			: `Workday ${runId} finished with status ${metrics.status} and score ${metrics.score}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Provider', value: providerId },
			{ label: 'Projects', value: actualProjects.length },
			{ label: 'Score', value: metrics.score },
			{ label: 'JSON report', value: reportRefs.jsonPath },
			{ label: 'Markdown report', value: reportRefs.markdownPath },
		],
		sections: [
			{ title: 'Checks', lines: metrics.checks.map((check) => `${check.name}: ${check.actual}/${check.expected} (${check.score})`) },
			{ title: 'Blockers', lines: metrics.blockers.length ? metrics.blockers : ['none'] },
		],
		exitCode: abortFailure || metrics.status === 'failed' ? 1 : 0,
		report: {
			runId,
			parameters,
			metrics,
			actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
			reportRefs,
		},
	});
}

async function runMarketInspection(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	if (action === 'workday-run') return runWorkdayRun(invocation, context);
	if (action === 'execution-runs') return runExecutionRunsInspection(invocation, context);
	if (action === 'workday-log') return runExecutionRunsInspection(invocation, context, { action: 'workday-log' });
	const teamId = stringArg(invocation, 'team');
	const projectId = stringArg(invocation, 'project');
	const providerId = stringArg(invocation, 'provider');
	const status = stringArg(invocation, 'status');
	const mode = stringArg(invocation, 'mode');
	const assignmentId = stringArg(invocation, 'assignment');
	const decisionId = stringArg(invocation, 'decision');
	const capacityPlanId = stringArg(invocation, 'capacity-plan') ?? stringArg(invocation, 'plan');
	const workdayId = stringArg(invocation, 'workday');
	if ((action === 'allocation-sets' || action === 'provider-sessions' || action === 'assignments' || action === 'assignment-explanation') && !teamId) {
		return fail(`Missing --team. Use \`trsd capacity ${action} --team <team-id> --json\`.`);
	}
	if ((action === 'agent-classes' || action === 'mode-runs' || action === 'fallback-outputs' || action === 'treedx-proxy-audit') && !projectId) {
		return fail(`Missing --project. Use \`trsd capacity ${action} --project <project-id> --json\`.`);
	}
	if ((action === 'decision-planning' || action === 'execution-inputs' || action === 'capacity-plans') && !decisionId) {
		return fail(`Missing --decision. Use \`trsd capacity ${action} --decision <decision-id> --json\`.`);
	}
	if (action === 'capacity-plan' && !capacityPlanId) {
		return fail('Missing --capacity-plan. Use `trsd capacity capacity-plan --capacity-plan <capacity-plan-id> --json`.');
	}
	if ((action === 'workday' || action === 'workday-summary') && !workdayId) {
		return fail(`Missing --workday. Use \`trsd capacity ${action} --workday <workday-id> --json\`.`);
	}
	if (action === 'assignment-explanation' && !assignmentId) {
		return fail('Missing --assignment. Use `trsd capacity assignment-explanation --assignment <assignment-id> --json`.');
	}
	const { profile, client, authMode } = createWorkdayTestMarketClient(invocation, context);
	const resolvedTeam = teamId
		? await resolveWorkdayTestTeam(client, teamId).catch(() => ({ teamId, teamSelector: teamId, team: null, projects: [] }))
		: null;
	const resolvedTeamId = resolvedTeam?.teamId ?? teamId;
	let path = '';
	let scopeLabel = '';
	if (action === 'allocation-sets') {
		path = `/v1/teams/${encodeURIComponent(resolvedTeamId!)}/capacity/allocation-sets`;
		scopeLabel = `team ${resolvedTeamId}`;
	} else if (action === 'provider-sessions') {
		path = `/v1/teams/${encodeURIComponent(resolvedTeamId!)}/capacity/provider-sessions${queryFromFilters({ providerId, status })}`;
		scopeLabel = `team ${resolvedTeamId}`;
	} else if (action === 'assignments') {
		path = `/v1/teams/${encodeURIComponent(resolvedTeamId!)}/capacity/assignments${queryFromFilters({ projectId, providerId, status })}`;
		scopeLabel = `team ${resolvedTeamId}`;
	} else if (action === 'agent-classes') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/agent-classes`;
		scopeLabel = `project ${projectId}`;
	} else if (action === 'mode-runs') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/agent-mode-runs${queryFromFilters({ mode, assignmentId })}`;
		scopeLabel = `project ${projectId}`;
	} else if (action === 'fallback-outputs') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/agent-fallback-outputs${queryFromFilters({ mode, status, assignmentId })}`;
		scopeLabel = `project ${projectId}`;
	} else if (action === 'treedx-proxy-audit') {
		path = `/v1/projects/${encodeURIComponent(projectId!)}/treedx-proxy-audit${queryFromFilters({ assignmentId })}`;
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
	} else if (action === 'workday-summary') {
		path = `/v1/workdays/${encodeURIComponent(workdayId!)}/summary`;
		scopeLabel = `workday ${workdayId}`;
	} else if (action === 'assignment-explanation') {
		path = `/v1/teams/${encodeURIComponent(resolvedTeamId!)}/capacity/assignments/${encodeURIComponent(assignmentId!)}/explanation`;
		scopeLabel = `team ${resolvedTeamId}`;
	}
	const response = await marketRequest<{
		ok: true;
		payload: unknown[] | Record<string, unknown>;
	}>(client, path, { requireAuth: true });
	const records = Array.isArray(response.payload) ? response.payload : response.payload ? [response.payload] : [];
	const decoratedRecords = decorateInspectionRecords(action, records);
	const explanationVisibility = action === 'assignment-explanation'
		? summarizeExecutionProviderVisibility({ explanation: records[0] as Record<string, unknown> | null })
		: null;
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Read ${records.length} ${action.replace(/-/gu, ' ')} record${records.length === 1 ? '' : 's'} for ${scopeLabel}.`,
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Auth', value: authMode === 'local_acceptance_admin' ? 'local_acceptance_admin' : 'session' }, { label: 'Scope', value: scopeLabel }, { label: 'Records', value: records.length }, ...(providerId ? [{ label: 'Provider filter', value: providerId }] : []), ...(status ? [{ label: 'Status filter', value: status }] : []), ...(mode ? [{ label: 'Mode filter', value: mode }] : []), ...(assignmentId ? [{ label: 'Assignment filter', value: assignmentId }] : [])],
		sections: [
			{ title: 'Records', lines: listLines(decoratedRecords, action) },
			...(explanationVisibility ? [{ title: 'Execution capability match', lines: capabilityMatchLines(explanationVisibility) }] : []),
			{
				title: 'Boundary',
				lines: ['Read-only inspection. Assignment creation, selection, and provider lifecycle remain owned by API coordination and reconciled provider runtime.'],
			},
		],
		report: {
			action,
			market: { id: profile.id, baseUrl: profile.baseUrl },
			scope: { teamId, projectId },
			filters: { providerId, status, mode, assignmentId, capacityPlanId },
			records: decoratedRecords,
			...(explanationVisibility ? { executionCapabilityMatch: executionCapabilityMatch(explanationVisibility) } : {}),
		},
	});
}

function grantAllocationLines(plan: Record<string, unknown>) {
	const grants = recordValue(plan, 'grants');
	if (!Array.isArray(grants) || grants.length === 0) return [];
	return grants.map((grant) => [`${recordValue(grant, 'grantScope') ?? 'grant'} ${recordValue(grant, 'environment') ?? 'all'}`, `allocation ${formatNumber(recordValue(grant, 'portfolioAllocationPercent'))}%`, `reserve pool ${formatNumber(recordValue(grant, 'reservePoolPercent'))}%`, `max daily project credits ${formatNumber(recordValue(grant, 'maxDailyProjectCredits'))}`, `overflow ${recordValue(grant, 'overflowPolicy') ?? 'soft_grant'}`, `emergency ${recordValue(grant, 'emergencyOverride') === true ? 'on' : 'off'}`].join(' | '));
}

async function runProjectCapacityPlan(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const projectId = stringArg(invocation, 'project');
	if (!projectId) return fail('Missing --project. Use `trsd capacity plan --project <project-id> --environment local`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const environment = environmentSelector(invocation);
	const response = await marketRequest<{
		ok: true;
		payload: Record<string, unknown>;
	}>(client, `/v1/projects/${encodeURIComponent(projectId)}/capacity-plan?environment=${encodeURIComponent(environment)}`, { requireAuth: true });
	const plan = response.payload;
	return guidedResult({
		command: 'capacity plan',
		summary: `Capacity plan for project ${projectId} in ${environment}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Project', value: projectId },
			{ label: 'Environment', value: environment },
			{
				label: 'Derived credits',
				value: formatNumber(recordValue(recordValue(plan, 'derivedCapacity'), 'totalDerivedAvailableCredits')),
			},
		],
		sections: [
			{ title: 'Native projection', lines: derivedCapacityLines(plan) },
			{ title: 'Allocation grants', lines: grantAllocationLines(plan) },
		],
		report: {
			action: 'plan',
			projectId,
			environment,
			market: { id: profile.id, baseUrl: profile.baseUrl },
			plan,
		},
	});
}

function providerMatcher(selector: string) {
	return (provider: unknown) => {
		const id = String(recordValue(provider, 'id') ?? '');
		const name = String(recordValue(provider, 'name') ?? '');
		return id === selector || name === selector;
	};
}

function migrationMissingFields(invocation: TreeseedParsedInvocation) {
	const missing = [];
	if (!stringArg(invocation, 'team')) missing.push('--team');
	if (!stringArg(invocation, 'provider')) missing.push('--provider');
	if (!stringArg(invocation, 'kind')) missing.push('--kind');
	if (!stringArg(invocation, 'nativeUnit')) missing.push('--native-unit');
	if (numberArg(invocation, 'limit') === null) missing.push('--limit');
	return missing;
}

async function runMigrateToDerived(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	if (!boolArg(invocation, 'toDerived')) {
		return fail('Missing --to-derived. Phase 8 supports `trsd capacity migrate --to-derived`.');
	}
	const missing = migrationMissingFields(invocation);
	const example = 'trsd capacity migrate --to-derived --team team_123 --provider provider_123 --kind codex_subscription --native-unit wall_minute --limit 480 --scope daily --reset-cadence daily --quota-visibility opaque --reserve-buffer-percent 20 --max-concurrent-workers 4 --project project_123 --portfolio-allocation-percent 100 --dry-run';
	if (missing.length > 0) {
		return fail(`Missing native capacity facts: ${missing.join(', ')}.\nExample: ${example}`);
	}
	const teamId = stringArg(invocation, 'team')!;
	const providerSelectorValue = stringArg(invocation, 'provider')!;
	const kind = stringArg(invocation, 'kind')!;
	const nativeUnit = stringArg(invocation, 'nativeUnit')!;
	const limitAmount = numberArg(invocation, 'limit')!;
	const scope = stringArg(invocation, 'scope') ?? 'daily';
	const resetCadence = stringArg(invocation, 'resetCadence') ?? 'daily';
	const quotaVisibility = stringArg(invocation, 'quotaVisibility') ?? 'opaque';
	const reserveBufferPercent = numberArg(invocation, 'reserveBufferPercent') ?? 20;
	const maxConcurrentWorkers = Math.max(1, Math.floor(numberArg(invocation, 'maxConcurrentWorkers') ?? 1));
	const environment = environmentSelector(invocation);
	const projectId = stringArg(invocation, 'project');
	const allocationPercent = numberArg(invocation, 'portfolioAllocationPercent');
	const dryRun = boolArg(invocation, 'dryRun');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: !dryRun });
	const providerList = dryRun ? { payload: [{ id: providerSelectorValue, name: providerSelectorValue }] } : await marketRequest<{ ok: true; payload: unknown[] }>(client, `/v1/teams/${encodeURIComponent(teamId)}/capacity-providers`, { requireAuth: true });
	const provider = (providerList.payload as unknown[]).find(providerMatcher(providerSelectorValue));
	if (!provider) return fail(`Capacity provider "${providerSelectorValue}" was not found in team ${teamId}.`);
	const providerId = String(recordValue(provider, 'id'));
	const executionProvider = {
		name: `${kind.replace(/_/gu, ' ')} ${nativeUnit}`,
		kind,
		nativeUnit,
		quotaVisibility,
		maxConcurrentWorkers,
		resetCadence,
		nativeLimits: [
			{
				scope,
				nativeUnit,
				limitAmount,
				reserveBufferPercent,
				resetCadence,
				confidence: 'estimated',
				source: 'operator_migration',
			},
		],
		metadata: {
			source: 'trsd capacity migrate --to-derived',
			staticCreditBudgetsPreservedAs: 'hybrid_fallback_cap',
		},
	};
	const grant =
		allocationPercent === null
			? null
			: {
					capacityProviderId: providerId,
					teamId,
					projectId,
					environment,
					grantScope: projectId ? 'project' : 'team',
					portfolioAllocationPercent: allocationPercent,
					overflowPolicy: 'soft_grant',
					metadata: {
						source: 'trsd capacity migrate --to-derived',
					},
				};
	if (!dryRun) {
		await marketRequest(client, `/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}`, {
			method: 'PATCH',
			body: {
				name: String(recordValue(provider, 'name') ?? providerId),
				creditBudgetMode: 'hybrid',
			},
			requireAuth: true,
		});
		await marketRequest(client, `/v1/teams/${encodeURIComponent(teamId)}/capacity-providers/${encodeURIComponent(providerId)}/execution-providers`, {
			method: 'POST',
			body: executionProvider,
			requireAuth: true,
		});
		if (grant) {
			await marketRequest(client, `/v1/teams/${encodeURIComponent(teamId)}/capacity-grants`, {
				method: 'POST',
				body: grant,
				requireAuth: true,
			});
		}
	}
	return guidedResult({
		command: 'capacity migrate',
		summary: dryRun ? 'Dry run: derived native capacity migration plan.' : 'Derived native capacity migration applied.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Provider', value: providerId },
			{
				label: 'Native limit',
				value: `${formatNumber(limitAmount)} ${nativeUnit} / ${scope}`,
			},
			{
				label: 'Reserve buffer',
				value: `${formatNumber(reserveBufferPercent)}%`,
			},
			{
				label: 'Allocation percent',
				value: allocationPercent === null ? null : `${formatNumber(allocationPercent)}%`,
			},
			{ label: 'Dry run', value: dryRun },
		],
		sections: [
			{
				title: 'Execution provider',
				lines: [`${executionProvider.name}: ${kind}, ${nativeUnit}, ${maxConcurrentWorkers} workers, ${quotaVisibility} quota visibility`],
			},
			...(grant
				? [
						{
							title: 'Allocation grant',
							lines: [`${grant.grantScope} ${projectId ?? teamId} in ${environment}: ${formatNumber(allocationPercent)}%`],
						},
					]
				: []),
		],
		report: {
			action: 'migrate',
			dryRun,
			teamId,
			providerId,
			executionProvider,
			grant,
		},
	});
}

async function runLifecycleAction(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const environment = 'local' as const;
	const target = { kind: 'persistent' as const, scope: environment };
	const agentPackageRoot = stringArg(invocation, 'agentPackageRoot');
	let desiredGraph: ReturnType<typeof compileTreeseedDesiredResourceGraph>;
	try {
		desiredGraph = compileTreeseedDesiredResourceGraph({
			tenantRoot: context.cwd,
			target,
		});
	} catch (error) {
		if (!agentPackageRoot || !isNonGitWorkspaceError(error)) throw error;
		const execute = boolArg(invocation, 'execute');
		const market = resolveMarket(invocation);
		const capacityConfigPath = resolveCapacityLaunchConfigPath(invocation, context);
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Capacity provider ${action} package-root plan rendered outside a git-backed Treeseed workspace.`,
			facts: [{ label: 'Market', value: `${market.id} (${market.baseUrl})` }, { label: 'Provider', value: providerSelector(invocation) }, { label: 'Agent package root', value: agentPackageRoot }, { label: 'Execute', value: execute ? 'yes' : 'no' }, ...(capacityConfigPath ? [{ label: 'Config', value: capacityConfigPath }] : [])],
			sections: [
				{
					title: 'Boundary',
					lines: ['Package-root fallback is diagnostic-only. Git-backed Treeseed workspaces use canonical reconciliation for provider lifecycle.'],
				},
			],
			report: {
				action,
				market: { id: market.id, baseUrl: market.baseUrl },
				provider: providerSelector(invocation),
				agentPackageRoot,
				...(capacityConfigPath ? { launchManifest: { path: capacityConfigPath } } : {}),
				execute,
				diagnosticOnly: true,
			},
		});
	}
	const selector: TreeseedReconcileSelector =
		action === 'build'
			? {
					environment,
					packageId: ['@treeseed/agent'],
					resourceKind: ['docker-image-build'],
				}
			: {
					environment,
					unitId: CAPACITY_PROVIDER_UNIT_IDS,
				};
	const units = action === 'build' ? compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector) : capacityProviderUnits(compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector));
	const execute = boolArg(invocation, 'execute');
	if (action === 'status' || action === 'logs') {
		const status = await collectTreeseedReconcileStatus({
			tenantRoot: context.cwd,
			target,
			env: context.env,
			units,
			selector,
		});
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Capacity provider ${action} resolved through canonical reconcile status.`,
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Units', value: status.units.length },
				{ label: 'Ready', value: status.ready ? 'yes' : 'no' },
			],
			sections: [
				{
					title: action === 'logs' ? 'Log Observations' : 'Units',
					lines: status.units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.unitId}`),
				},
				{ title: 'Blockers', lines: status.blockers },
			],
			exitCode: status.ready ? 0 : 1,
			report: {
				action,
				desiredGraph,
				status,
			},
		});
	}
	const market = resolveMarket(invocation);
	const capacityConfigPath = resolveCapacityLaunchConfigPath(invocation, context);
	const planOnly = boolArg(invocation, 'plan') || !execute;
	const result =
		action === 'down'
			? execute
				? await destroyTreeseedTargetUnits({
						tenantRoot: context.cwd,
						target,
						env: context.env,
						units,
						selector,
						write: (line) => context.write(`[capacity] ${line}`, 'stderr'),
					})
				: await planTreeseedReconciliation({
						tenantRoot: context.cwd,
						target,
						env: context.env,
						units,
						selector,
					})
			: planOnly
				? await planTreeseedReconciliation({
						tenantRoot: context.cwd,
						target,
						env: context.env,
						units,
						selector,
					})
				: await reconcileTreeseedTarget({
						tenantRoot: context.cwd,
						target,
						env: {
							...context.env,
							TREESEED_MARKET_URL: market.baseUrl,
							TREESEED_MARKET_ID: market.id,
							TREESEED_MANAGER_ID: market.id,
							TREESEED_PROVIDER_ENVIRONMENT: providerSelector(invocation),
							...(capacityConfigPath ? { TREESEED_CAPACITY_CONFIG_PATH: capacityConfigPath } : {}),
						},
						units,
						selector,
						dryRun: planOnly,
						write: (line) => context.write(`[capacity] ${line}`, 'stderr'),
					});
	return guidedResult({
		command: `capacity ${action}`,
		summary: planOnly ? `Capacity provider ${action} reconcile plan rendered.` : `Capacity provider ${action} reconciled through canonical adapters.`,
		facts: [{ label: 'Market', value: `${market.id} (${market.baseUrl})` }, { label: 'Provider', value: providerSelector(invocation) }, { label: 'Execute', value: execute ? 'yes' : 'no' }, ...(capacityConfigPath ? [{ label: 'Config', value: capacityConfigPath }] : []), { label: 'Units', value: units.length }],
		sections: [
			{
				title: 'Units',
				lines: units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.logicalName}`),
			},
		],
		report: {
			action,
			market: { id: market.id, baseUrl: market.baseUrl },
			provider: providerSelector(invocation),
			...(capacityConfigPath ? { launchManifest: { path: capacityConfigPath } } : {}),
			execute,
			desiredGraph,
			result,
		},
	});
}

async function invokeProviderEntrypoint(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const market = resolveMarket(invocation);
	const target = { kind: 'persistent' as const, scope: 'local' as const };
	const agentPackageRoot = stringArg(invocation, 'agentPackageRoot');
	let desiredGraph: ReturnType<typeof compileTreeseedDesiredResourceGraph>;
	try {
		desiredGraph = compileTreeseedDesiredResourceGraph({
			tenantRoot: context.cwd,
			target,
		});
	} catch (error) {
		if (!agentPackageRoot || !isNonGitWorkspaceError(error)) throw error;
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Capacity provider ${action} package-root diagnostic rendered outside a git-backed Treeseed workspace.`,
			facts: [
				{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
				{ label: 'Provider', value: providerSelector(invocation) },
				{ label: 'Agent package root', value: agentPackageRoot },
				{ label: 'Ready', value: 'diagnostic-only' },
			],
			sections: [
				{
					title: 'Boundary',
					lines: ['Package-root fallback is diagnostic-only. Git-backed Treeseed workspaces use canonical reconciliation for provider lifecycle.'],
				},
			],
			report: {
				ok: true,
				action,
				market: { id: market.id, baseUrl: market.baseUrl },
				provider: providerSelector(invocation),
				agentPackageRoot,
				diagnosticOnly: true,
			},
		});
	}
	const selector: TreeseedReconcileSelector = {
		environment: 'local',
		unitId: CAPACITY_PROVIDER_UNIT_IDS,
	};
	const units = capacityProviderUnits(compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector));
	const status = await collectTreeseedReconcileStatus({
		tenantRoot: context.cwd,
		target,
		env: context.env,
		units,
		selector,
	});
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity provider ${action} is reported through reconcile status; direct provider entrypoint execution has been removed.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Ready', value: status.ready ? 'yes' : 'no' },
		],
		sections: [
			{
				title: 'Units',
				lines: status.units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.unitId}`),
			},
			{ title: 'Native budget file', lines: nativeBudgetSummaryLines(null) },
			{ title: 'Blockers', lines: status.blockers },
		],
		exitCode: status.ready ? 0 : 1,
		report: {
			ok: status.ready,
			action,
			desiredGraph,
			status,
		},
	});
}

export const handleCapacity: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'doctor';
	if (action === 'plan' && stringArg(invocation, 'project')) {
		try {
			return runProjectCapacityPlan(invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (MARKET_CAPACITY_ACTIONS.has(action)) {
		try {
			if (action === 'migrate') return runMigrateToDerived(invocation, context);
			return fail(`Unknown capacity action "${action}".`);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (MARKET_INSPECTION_ACTIONS.has(action)) {
		try {
			return await runMarketInspection(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (PROVIDER_LIFECYCLE_ACTIONS.has(action)) {
		try {
			return await runLifecycleAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (PROVIDER_ENTRYPOINT_ACTIONS.has(action)) {
		try {
			return await invokeProviderEntrypoint(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	return fail(`Unknown capacity action "${action}". Use doctor, register, plan, migrate, allocation-sets, agent-classes, provider-sessions, assignments, mode-runs, execution-runs, workday-log, decision-planning, execution-inputs, capacity-plans, capacity-plan, workday, workday-summary, workday-run, assignment-explanation, fallback-outputs, treedx-proxy-audit, build, up, down, restart, logs, status, or test-local.`);
};
