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

const PROVIDER_LIFECYCLE_ACTIONS = new Set(['build', 'up', 'down', 'restart', 'logs', 'status', 'test-local']);
const PROVIDER_ENTRYPOINT_ACTIONS = new Set(['doctor', 'register', 'plan']);
const MARKET_CAPACITY_ACTIONS = new Set(['migrate']);
const MARKET_INSPECTION_ACTIONS = new Set(['allocation-sets', 'agent-classes', 'provider-sessions', 'assignments', 'mode-runs', 'execution-runs', 'decision-planning', 'execution-inputs', 'capacity-plans', 'capacity-plan', 'workday', 'workday-summary', 'workday-test', 'assignment-explanation', 'fallback-outputs', 'treedx-proxy-audit']);
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

async function executionRunsForAssignments(client: unknown, teamId: string, assignmentIds: string[]) {
	const rows = await Promise.all(assignmentIds.map(async (assignmentId) => {
		const response = await marketRequest<{ ok: true; payload: unknown[] }>(
			client,
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/execution-runs${queryFromFilters({ assignmentId, limit: 50 })}`,
			{ requireAuth: true },
		).catch(() => ({ ok: false, payload: [] as unknown[] }));
		return Array.isArray(response.payload) ? response.payload.filter(isRecord) : [];
	}));
	return rows.flat().map((row) => normalizeExecutionRunRecord(redactAuditValue(row) as Record<string, unknown>));
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
) {
	const entries = await Promise.all(projectStates.map(async (projectState) => {
		const response = await (
			client as {
				providerAssignments(teamId: string, options?: { projectId?: string | null; providerId?: string | null }): Promise<{ payload?: unknown[] }>;
			}
		).providerAssignments(teamId, { projectId: projectState.projectId, providerId }).catch(() => ({ payload: [] as unknown[] }));
		const assignments = (Array.isArray(response.payload) ? response.payload : [])
			.filter(isRecord)
			.filter((assignment) => projectState.assignmentIds.length === 0 || projectState.assignmentIds.includes(String(assignment.id ?? '')));
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
) {
	const deadline = Date.now() + waitSeconds * 1000;
	let snapshots = await fetchWorkdayTestAssignments(client, teamId, projectStates, providerId);
	while (Date.now() < deadline) {
		const unfinished = [...snapshots.values()].flat().filter(isUnfinishedAssignment);
		if (unfinished.length === 0) {
			return { completed: true, snapshots, unfinished };
		}
		await sleep(Math.min(5000, Math.max(500, deadline - Date.now())));
		snapshots = await fetchWorkdayTestAssignments(client, teamId, projectStates, providerId);
	}
	const unfinished = [...snapshots.values()].flat().filter(isUnfinishedAssignment);
	return { completed: unfinished.length === 0, snapshots, unfinished };
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

async function runExecutionRunsInspection(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const teamSelector = stringArg(invocation, 'team');
	if (!teamSelector) {
		return fail('Missing --team. Use `trsd capacity execution-runs --team <team-id-or-slug> --format yaml`.');
	}
	const projectId = stringArg(invocation, 'project');
	const providerId = stringArg(invocation, 'provider');
	const status = stringArg(invocation, 'status');
	const mode = stringArg(invocation, 'mode');
	const assignmentId = stringArg(invocation, 'assignment');
	const workdayId = stringArg(invocation, 'workday');
	const executionProviderId = stringArg(invocation, 'execution-provider');
	const kindFilter = stringArg(invocation, 'kind');
	const outputFormat = stringArg(invocation, 'format');
	const maxRuns = positiveNumberArg(invocation, 'limit', 200);
	const { profile, client, authMode } = createWorkdayTestMarketClient(invocation, context);
	const team = await resolveWorkdayTestTeam(client, teamSelector);
	const teamId = team.teamId;
	const response = await marketRequest<{ ok: true; payload: unknown[] }>(
		client,
		`/v1/teams/${encodeURIComponent(teamId)}/capacity/execution-runs${queryFromFilters({
			projectId,
			providerId,
			status,
			mode,
			assignmentId,
			workdayId,
			executionProviderId,
			limit: maxRuns,
		})}`,
		{ requireAuth: true },
	);
	const rows = (Array.isArray(response.payload) ? response.payload : [])
		.filter(isRecord)
		.filter((row) => !kindFilter || String(recordValue(recordValue(row, 'executionProvider'), 'id') ?? '').toLowerCase().includes(kindFilter.toLowerCase()))
		.slice(0, maxRuns)
		.map((row) => normalizeExecutionRunRecord(redactAuditValue(row) as Record<string, unknown>));
	const yaml = toYaml(rows);
	if (outputFormat === 'yaml') {
		return {
			exitCode: 0,
			stdout: [yaml],
			report: {
				action: 'execution-runs',
				ok: true,
				market: { id: profile.id, baseUrl: profile.baseUrl },
				authMode,
				scope: { teamId, projectId },
				filters: { providerId, status, mode, assignmentId, workdayId, executionProviderId, kind: kindFilter },
				records: rows,
				yaml,
			},
		};
	}
	if (outputFormat === 'json') {
		return {
			exitCode: 0,
			stdout: [JSON.stringify(rows, null, 2)],
			report: { action: 'execution-runs', ok: true, records: rows },
		};
	}
	const timelineLines = rows.map((row) => {
		const agent = recordValue(row, 'agent') as Record<string, unknown> | undefined;
		const assignment = recordValue(row, 'assignment') as Record<string, unknown> | undefined;
		const timing = recordValue(row, 'timing') as Record<string, unknown> | undefined;
		const artifacts = Array.isArray(recordValue(row, 'contentArtifactRefs')) ? recordValue(row, 'contentArtifactRefs') as unknown[] : [];
		return `${String(timing?.startedAt ?? timing?.createdAt ?? 'time?')} | ${String(row.status ?? 'unknown')} | ${String(agent?.projectSlug ?? agent?.projectId ?? 'project?')} | ${String(agent?.agentId ?? 'agent?')} | assignment=${String(assignment?.id ?? 'n/a')} | artifacts=${uniqueContentArtifacts(artifacts).length}`;
	});
	const treeLines: string[] = [];
	const byProject = new Map<string, Record<string, unknown>[]>();
	for (const row of rows) {
		const agent = recordValue(row, 'agent') as Record<string, unknown> | undefined;
		const key = String(agent?.projectSlug ?? agent?.projectId ?? 'unknown-project');
		byProject.set(key, [...(byProject.get(key) ?? []), row]);
	}
	for (const [project, projectRows] of byProject) {
		treeLines.push(project);
		for (const row of projectRows) {
			const agent = recordValue(row, 'agent') as Record<string, unknown> | undefined;
			const assignment = recordValue(row, 'assignment') as Record<string, unknown> | undefined;
			const artifacts = uniqueContentArtifacts(Array.isArray(recordValue(row, 'contentArtifactRefs')) ? recordValue(row, 'contentArtifactRefs') as Array<Record<string, unknown>> : []) as Array<Record<string, unknown>>;
			treeLines.push(`  ${String(assignment?.workdayId ?? 'workday?')}`);
			treeLines.push(`    ${String(assignment?.id ?? 'assignment?')} -> ${String(row.id ?? 'run?')} ${String(row.status ?? 'unknown')} ${String(agent?.agentId ?? 'agent?')}`);
			for (const artifact of artifacts) {
				treeLines.push(`      content: ${String(artifact.contentPath ?? artifact.uri ?? 'artifact')}`);
			}
		}
	}
	if (outputFormat === 'timeline' || outputFormat === 'tree') {
		return {
			exitCode: 0,
			stdout: [outputFormat === 'tree' ? treeLines.join('\n') : timelineLines.join('\n')],
			report: { action: 'execution-runs', ok: true, records: rows },
		};
	}
	return guidedResult({
		command: 'capacity execution-runs',
		summary: `Read ${rows.length} execution run audit record${rows.length === 1 ? '' : 's'} for team ${teamId}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Records', value: rows.length },
			...(providerId ? [{ label: 'Provider filter', value: providerId }] : []),
			...(workdayId ? [{ label: 'Workday filter', value: workdayId }] : []),
			...(kindFilter ? [{ label: 'Kind filter', value: kindFilter }] : []),
		],
		sections: [
			{ title: 'Timeline', lines: timelineLines.slice(0, 25) },
			{ title: 'YAML', lines: ['Use `--format yaml` to print the full redacted YAML list.'] },
		],
		report: {
			action: 'execution-runs',
			market: { id: profile.id, baseUrl: profile.baseUrl },
			authMode,
			scope: { teamId, projectId },
			filters: { providerId, status, mode, assignmentId, workdayId, executionProviderId, kind: kindFilter },
			records: rows,
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
	const planningCoverage = expected.filter((slug) => Number(bySlug.get(slug)?.planningRuns ?? 0) > 0).length;
	const contentCoverage = expected.filter((slug) => Number(bySlug.get(slug)?.contentArtifacts ?? 0) > 0).length;
	const actingCoverage = input.planningOnly
		? expected.length
		: expected.filter((slug) => Number(bySlug.get(slug)?.actingRuns ?? 0) > 0 || Number(bySlug.get(slug)?.outputs ?? 0) > 0).length;
	const checks = [
		{ name: 'projectCoverage', actual: projectCoverage, expected: expected.length },
		{ name: 'agentCoverage', actual: agentCoverage, expected: expected.length },
		{ name: 'planningCoverage', actual: planningCoverage, expected: expected.length },
		{ name: 'contentArtifactCoverage', actual: contentCoverage, expected: expected.length },
		{ name: 'actingCoverage', actual: actingCoverage, expected: expected.length },
		{ name: 'auditCompleteness', actual: input.auditEvents > 0 ? 1 : 0, expected: 1 },
		{ name: 'providerHealth', actual: input.providerReady ? 1 : 0, expected: 1 },
	].map((check) => ({
		...check,
		score: Math.round(Math.max(0, Math.min(1, check.actual / Math.max(1, check.expected))) * 100),
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

async function writeWorkdayTestReportFiles(context: TreeseedCommandContext, input: {
	runId: string;
	reportDir: string;
	parameters: Record<string, unknown>;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	metrics: Record<string, unknown>;
}) {
	const reportDir = resolve(context.cwd, input.reportDir);
	await mkdir(reportDir, { recursive: true });
	const jsonPath = resolve(reportDir, `workday-test-${input.runId}.json`);
	const markdownPath = resolve(reportDir, `workday-test-${input.runId}.md`);
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
		`# Workday Test ${input.runId}`,
		'',
		`Status: ${String(input.metrics.status ?? 'unknown')}`,
		`Score: ${String(input.metrics.score ?? 'n/a')}`,
		`Scenario: ${String(input.parameters.scenarioId ?? 'portfolio-local')}`,
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
				source: 'workday_test_agent_content',
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

async function prepareWorkdayTestAllocation(
	client: ReturnType<typeof createMarketClientForInvocation>['client'],
	teamId: string,
	providerId: string,
	runId: string,
	projects: Array<Record<string, unknown>>,
) {
	const percent = projects.length > 0 ? Math.round((100 / projects.length) * 100) / 100 : 100;
	const allocationSetId = `workday-test-${runId}-allocation`.replace(/[^a-zA-Z0-9_.-]+/gu, '-').slice(0, 96);
	const allocationSet = await client.createCapacityAllocationSet(teamId, {
		id: allocationSetId,
		version: runId,
		status: 'draft',
		policy: {
			source: 'workday_test',
			capacityProviderId: providerId,
			environment: 'local',
			totalPercent: 100,
		},
		slices: projects.map((project) => ({
			projectId: project.id,
			capacityProviderId: providerId,
			environment: 'local',
			percent,
			metadata: { source: 'workday_test', runId, slug: project.slug },
		})),
		metadata: { source: 'workday_test', runId },
	}).catch(() => null);
	if (allocationSet?.payload?.id) {
		await client.activateCapacityAllocationSet(teamId, String(allocationSet.payload.id)).catch(() => null);
	}
	for (const project of projects) {
		await client.createCapacityGrant(teamId, {
			id: `${providerId}:${project.id}:workday-test:${runId}`,
			capacityProviderId: providerId,
			laneId: `${providerId}:agent-capacity`,
			grantScope: 'project',
			teamId,
			projectId: project.id,
			environment: 'local',
			state: 'active',
			priorityWeight: 100,
			overflowPolicy: 'approval_required',
			portfolioAllocationPercent: percent,
			metadata: {
				source: 'workday_test',
				runId,
				allocationSetId: allocationSet?.payload?.id ?? null,
			},
		}).catch(() => null);
	}
	return allocationSet?.payload ?? null;
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
		write: (line) => context.write(`[workday-test] ${line}`, 'stderr'),
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

async function runWorkdayTest(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const { profile, client, authMode } = createWorkdayTestMarketClient(invocation, context);
	const teamSelector = stringArg(invocation, 'team');
	if (!teamSelector) return fail('Missing --team. Use `trsd capacity workday-test --team <team-id> --provider local --execute --json`.');
	const teamResolution = await resolveWorkdayTestTeam(client, teamSelector);
	const teamId = teamResolution.teamId;
	const providerSelectorValue = providerSelector(invocation);
	const projectSlugs = csvArg(invocation, 'projects', WORKDAY_TEST_PROJECT_SLUGS);
	const providerResolution = await resolveWorkdayTestProviderId(client, teamId, providerSelectorValue);
	const providerId = providerResolution.providerId;
	const parameters = {
		scenarioId: stringArg(invocation, 'scenario') ?? 'portfolio-local',
		providerId,
		providerSelector: providerSelectorValue,
		projects: projectSlugs,
		workdays: positiveNumberArg(invocation, 'workdays', 1),
		maxAssignments: positiveNumberArg(invocation, 'maxAssignments', projectSlugs.length),
		waitSeconds: positiveNumberArg(invocation, 'waitSeconds', boolArg(invocation, 'execute') ? 90 : 0),
		planningOnly: boolArg(invocation, 'planningOnly') || !boolArg(invocation, 'acting'),
		dryRun: boolArg(invocation, 'dryRun') || !boolArg(invocation, 'execute'),
		reportDir: stringArg(invocation, 'reportDir') ?? '.treeseed/test-reports',
	};
	const runResponse = await client.createWorkdayTestRun(teamId, {
		capacityProviderId: providerId,
		scenarioId: parameters.scenarioId,
		status: parameters.dryRun ? 'planned' : 'running',
		environment: 'local',
		startedAt: parameters.dryRun ? null : new Date().toISOString(),
		parameters,
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
		await client.createWorkdayTestEvent(teamId, runId, body).catch(() => null);
	};
	await event({
		eventType: 'command.started',
		status: 'recorded',
		title: 'Workday test command started',
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
	const localTreeDxRepositoryIds = new Map<string, string>();
	if (!parameters.dryRun && profile.id === 'local') {
		try {
			const localTreeDx = await ensureLocalTreeDxForWorkdayTest(context, projectSlugs);
			for (const [slug, repositoryId] of Object.entries(localTreeDx.repositoryIdsBySlug)) {
				localTreeDxRepositoryIds.set(slug, repositoryId);
			}
			await event({
				eventType: 'treedx.local_reconciled',
				status: 'recorded',
				title: 'Local TreeDX repositories reconciled for workday test',
				context: localTreeDx,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await event({
				eventType: 'treedx.local_reconcile_failed',
				status: 'error',
				title: 'Local TreeDX reconciliation failed before assignment creation',
				context: { error: message },
			});
			await client.updateWorkdayTestRun(teamId, runId, {
				status: 'failed',
				completedAt: new Date().toISOString(),
				summaryMetrics: {
					score: 0,
					status: 'failed',
					blockers: [message],
				},
			}).catch(() => null);
			return fail(`Local TreeDX readiness failed: ${message}`);
		}
	}
	const projectsResponse = teamResolution.projects.length > 0
		? { payload: teamResolution.projects }
		: await client.projects(teamId);
	const projects = (projectsResponse.payload as Array<Record<string, unknown>>)
		.filter((project) => projectSlugs.includes(String(project.slug ?? project.id)));
	const unexpectedSeedProjects = (projectsResponse.payload as Array<Record<string, unknown>>)
		.filter((project) => String(project.slug ?? project.id) === 'karyon');
	if (unexpectedSeedProjects.length > 0) {
		await event({
			eventType: 'seed.boundary.warning',
			status: 'warning',
			title: 'Unexpected Karyon project found in Treeseed team local state',
			context: { projectIds: unexpectedSeedProjects.map((project) => project.id) },
		});
	}
	if (!parameters.dryRun) {
		const allocationSet = await prepareWorkdayTestAllocation(client, teamId, providerId, runId, projects);
		await event({
			eventType: 'allocation.prepared',
			status: allocationSet ? 'recorded' : 'warning',
			title: allocationSet ? 'Prepared workday test allocation set and project grants' : 'Workday test allocation set was not created',
			context: { providerId, allocationSetId: allocationSet && typeof allocationSet === 'object' ? (allocationSet as Record<string, unknown>).id : null },
		});
	}
	const providerSessions = await client.providerAvailabilitySessions(teamId, { providerId }).catch(() => ({ payload: [] as unknown[] }));
	const providerReady = (providerSessions.payload as Array<Record<string, unknown>>).some((session) => ['open', 'active', 'available'].includes(String(session.status ?? session.state ?? '').toLowerCase()));
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
	let assignmentBudget = parameters.maxAssignments;
	const perProjectAssignmentLimit = Math.max(1, Math.ceil(parameters.maxAssignments / Math.max(1, projects.length)));
	for (const project of projects) {
		const projectId = String(project.id);
		const slug = String(project.slug ?? project.id);
		const blockers: string[] = [];
		const agentClassesResponse = await client.projectAgentClasses(projectId).catch(() => ({ payload: [] as unknown[] }));
		const preparedAgents = await ensureWorkdayTestAgentClasses(client, context, projectId, slug, agentClassesResponse.payload as Array<Record<string, unknown>>);
		const agentClasses = preparedAgents.agentClasses;
		if (preparedAgents.created.length > 0) {
			await event({
				eventType: 'agent_classes.materialized',
				projectId,
				status: 'recorded',
				title: `Materialized ${preparedAgents.created.length} agent classes for ${slug}`,
				context: {
					contentAgentCount: preparedAgents.contentAgentCount,
					createdAgentClassIds: preparedAgents.created.map((agentClass) => agentClass.id),
				},
			});
		}
		let workdayId: string | null = null;
		let assignmentCount = 0;
		const assignmentIds: string[] = [];
		if (!parameters.dryRun) {
			const created = await client.createWorkday({
				id: safeWorkdayIdPart(`workday-test-${runId}-${slug}`),
				projectId,
				environment: 'local',
				status: 'draft',
				availableCredits: 10,
				metadata: { source: 'workday_test', runId, slug },
			}).catch((error) => {
				blockers.push(error instanceof Error ? error.message : String(error));
				return null;
			});
			workdayId = created?.payload?.id ? String(created.payload.id) : null;
			if (workdayId) {
				await client.startWorkday(workdayId).catch((error) => blockers.push(error instanceof Error ? error.message : String(error)));
				await event({ eventType: 'workday.started', projectId, workdayId, title: `Started test workday for ${slug}` });
			}
			const projectAssignmentLimit = Math.max(0, Math.min(WORKDAY_TEST_AGENT_COUNT, assignmentBudget, perProjectAssignmentLimit));
			const preferredAgents = [
				...preparedAgents.contentAgents.filter((agent) => agent.handler === 'plan'),
				...preparedAgents.contentAgents.filter((agent) => agent.handler !== 'plan'),
			].slice(0, projectAssignmentLimit);
			const classById = new Map(agentClasses.map((agentClass) => [String(agentClass.id ?? agentClass.slug), agentClass]));
			for (const agent of preferredAgents) {
				const agentClass = classById.get(agent.projectAgentClassId);
				if (!agentClass) {
					blockers.push(`agent ${agent.slug} references missing project agent class ${agent.projectAgentClassId}`);
					continue;
				}
				const contentRoot = slug === 'market' ? 'src/content' : 'docs/src/content';
				const assignmentId = safeWorkdayIdPart(`workday-test-${runId}-${slug}-${agent.slug}`);
				const treeDxRepositoryId = localTreeDxRepositoryIds.get(slug) ?? treeDxRepositoryIdForProjectSlug(slug);
				const treedxProxyHandle = {
					id: `tdx_${assignmentId}`,
					teamId,
					projectId,
					assignmentId,
					repositoryId: treeDxRepositoryId,
					allowedOperations: ['files:read', 'files:search'],
					allowedPaths: [`${contentRoot}/**`],
					expiresAt: new Date(Date.now() + 3600_000).toISOString(),
					metadata: {
						source: 'workday_test',
						scenarioId: parameters.scenarioId,
						runId,
						repositoryId: treeDxRepositoryId,
					},
				};
				const assignment = await client.createProviderAssignment(teamId, {
					id: assignmentId,
					projectId,
					capacityProviderId: providerId,
					projectAgentClassId: agentClass.id,
					workDayId: workdayId,
					mode: 'planning',
					status: 'pending',
					agentId: agent.slug,
					handlerId: agent.handler,
					capacityEnvelope: {
						workDayId: workdayId,
						projectId,
						capacityProviderId: providerId,
						environment: 'local',
						reservedCredits: 1,
					},
					decisionInput: {
						kind: 'workday_test_planning',
						projectId,
						agentId: agent.slug,
						handlerId: agent.handler,
						input: {
							objective: 'Verify package knowledge hub readiness and planning behavior.',
							agentSlug: agent.slug,
							artifactKind: 'planning_note',
							subjectModel: 'objective',
							subjectId: 'core',
							contentRoot,
							dryRun: false,
						},
					},
					allowedOutputs: { paths: [`${contentRoot}/**`], types: ['content_artifact_refs', 'planning_note'] },
					workspaceContext: {
						workspaceAccessMode: 'context_only',
						treedxProxyHandle,
					},
					treedxProxyHandle,
					explanation: { source: 'workday_test', scenarioId: parameters.scenarioId, runId, agentSlug: agent.slug },
					synthesizedFrom: 'workday_test',
					synthesisKey: `${runId}:${projectId}:${agent.slug}`,
					metadata: { workdayTestRunId: runId, agentSlug: agent.slug, contentRoot, treeDxRepositoryId },
				}).catch((error) => {
					blockers.push(error instanceof Error ? error.message : String(error));
					return null;
				});
				if (assignment?.payload?.id) {
					assignmentBudget -= 1;
					assignmentCount += 1;
					assignmentIds.push(String(assignment.payload.id));
					await event({ eventType: 'assignment.created', projectId, workdayId, assignmentId: String(assignment.payload.id), title: `Created planning assignment for ${slug}` });
				}
			}
		}
		projectStates.push({
			projectId,
			slug,
			workdayId,
			agentClasses,
			contentAgents: preparedAgents.contentAgents,
			contentAgentCount: preparedAgents.contentAgentCount,
			assignmentIds,
			assignmentCount,
			blockers,
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
		const waitResult = await waitForWorkdayTestAssignments(client, teamId, projectStates, providerId, parameters.waitSeconds);
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
	const actualProjects: Array<Record<string, unknown>> = [];
	for (const projectState of projectStates) {
		const projectAssignments = waitedAssignmentSnapshots?.get(projectState.projectId)
			?? (await fetchWorkdayTestAssignments(client, teamId, [projectState], providerId)).get(projectState.projectId)
			?? [];
		const projectAssignmentIds = projectAssignments.map((assignment) => String(assignment.id ?? '')).filter(Boolean);
		const modeRunResponses = await Promise.all(projectAssignmentIds.map((assignmentId) => (
			client.projectAgentModeRuns(projectState.projectId, { assignmentId }).catch(() => ({ payload: [] as unknown[] }))
		)));
		const projectModeRuns = modeRunResponses.flatMap((response) => Array.isArray(response.payload) ? response.payload : []);
		const planningRuns = projectModeRuns.filter((run) => String(recordValue(run, 'mode') ?? '').toLowerCase() === 'planning');
		const actingRuns = projectModeRuns.filter((run) => String(recordValue(run, 'mode') ?? '').toLowerCase() === 'acting');
		const executionRuns = await executionRunsForAssignments(client, teamId, projectAssignmentIds);
		const pendingAssignments = projectAssignments.filter((assignment) => {
			return isUnfinishedAssignment(assignment);
		});
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
		if (pendingAssignments.length > 0 && leaseDiagnostics.length === 0) {
			projectState.blockers.push(`${pendingAssignments.length} assignment(s) remained unfinished without lease diagnostics`);
		} else if (pendingAssignments.length > 0) {
			const reasons = leaseDiagnostics.flatMap((diagnostic) => Array.isArray((diagnostic as Record<string, unknown>).reasons)
				? ((diagnostic as Record<string, unknown>).reasons as unknown[]).map(String)
				: []);
			const timedOutCount = pendingAssignments.filter((assignment) => waitTimedOutAssignmentIds.has(String(assignment.id ?? ''))).length;
			projectState.blockers.push(`${pendingAssignments.length} assignment(s) remained unfinished${timedOutCount > 0 ? ` after ${parameters.waitSeconds}s` : ''}${reasons.length ? `: ${[...new Set(reasons)].join(', ')}` : ''}`);
		}
		const contentArtifacts = uniqueContentArtifacts([
			...projectAssignments.flatMap(assignmentContentArtifacts),
			...projectModeRuns.flatMap(modeRunContentArtifacts),
			...executionRuns.flatMap(modeRunContentArtifacts),
		]);
		if (projectState.contentAgentCount < WORKDAY_TEST_AGENT_COUNT) projectState.blockers.push(`expected ${WORKDAY_TEST_AGENT_COUNT} content agents, found ${projectState.contentAgentCount}`);
		if (!parameters.dryRun && projectAssignmentIds.length > 0 && projectModeRuns.length === 0) {
			projectState.blockers.push('created assignments did not produce assignment-scoped mode-run telemetry');
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
		actualProjects.push({
			projectId: projectState.projectId,
			slug: projectState.slug,
			workdayId: projectState.workdayId,
			agentCount: projectState.contentAgentCount,
			agentClassCount: projectState.agentClasses.length,
			assignments: Math.max(projectState.assignmentCount, projectAssignments.length),
			pendingAssignments: pendingAssignments.length,
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
			await client.completeWorkday(projectState.workdayId).catch(() => null);
			await event({
				eventType: 'workday.completed',
				projectId: projectState.projectId,
				workdayId: projectState.workdayId,
				title: `Completed test workday for ${projectState.slug}`,
			});
		}
	}
	const metrics = workdayTestScore({
		expectedProjects: projectSlugs,
		actualProjects,
		providerReady,
		auditEvents: eventCount,
		planningOnly: parameters.planningOnly,
	});
	const reportRefs = await writeWorkdayTestReportFiles(context, {
		runId,
		reportDir: parameters.reportDir,
		parameters,
		expected: { projects: projectSlugs, agentCountPerProject: WORKDAY_TEST_AGENT_COUNT },
		actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
		metrics,
	});
	await client.updateWorkdayTestRun(teamId, runId, {
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
	await event({ eventType: 'command.completed', status: metrics.status, title: 'Workday test command completed', refs: reportRefs });
	return guidedResult({
		command: 'capacity workday-test',
		summary: `Workday test ${runId} finished with status ${metrics.status} and score ${metrics.score}.`,
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
		exitCode: metrics.status === 'failed' ? 1 : 0,
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
	if (action === 'workday-test') return runWorkdayTest(invocation, context);
	if (action === 'execution-runs') return runExecutionRunsInspection(invocation, context);
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
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	let path = '';
	let scopeLabel = '';
	if (action === 'allocation-sets') {
		path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/allocation-sets`;
		scopeLabel = `team ${teamId}`;
	} else if (action === 'provider-sessions') {
		path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/provider-sessions${queryFromFilters({ providerId, status })}`;
		scopeLabel = `team ${teamId}`;
	} else if (action === 'assignments') {
		path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments${queryFromFilters({ projectId, providerId, status })}`;
		scopeLabel = `team ${teamId}`;
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
		path = `/v1/teams/${encodeURIComponent(teamId!)}/capacity/assignments/${encodeURIComponent(assignmentId!)}/explanation`;
		scopeLabel = `team ${teamId}`;
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
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Scope', value: scopeLabel }, { label: 'Records', value: records.length }, ...(providerId ? [{ label: 'Provider filter', value: providerId }] : []), ...(status ? [{ label: 'Status filter', value: status }] : []), ...(mode ? [{ label: 'Mode filter', value: mode }] : []), ...(assignmentId ? [{ label: 'Assignment filter', value: assignmentId }] : [])],
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
	return fail(`Unknown capacity action "${action}". Use doctor, register, plan, migrate, allocation-sets, agent-classes, provider-sessions, assignments, mode-runs, execution-runs, decision-planning, execution-inputs, capacity-plans, capacity-plan, workday, workday-summary, workday-test, assignment-explanation, fallback-outputs, treedx-proxy-audit, build, up, down, restart, logs, status, or test-local.`);
};
