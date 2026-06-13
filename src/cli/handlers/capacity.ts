import { resolve } from 'node:path';
import { resolveMarketProfile } from '@treeseed/sdk/market-client';
import {
	collectTreeseedReconcileStatus,
	destroyTreeseedTargetUnits,
	planTreeseedReconciliation,
	reconcileTreeseedTarget,
	type TreeseedReconcileSelector,
} from '@treeseed/sdk/reconcile';
import { compileTreeseedDesiredResourceGraph, compileTreeseedDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import type { TreeseedCommandContext, TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';

const PROVIDER_LIFECYCLE_ACTIONS = new Set(['build', 'up', 'down', 'restart', 'logs', 'status', 'test-local']);
const PROVIDER_ENTRYPOINT_ACTIONS = new Set(['doctor', 'register', 'plan']);
const MARKET_CAPACITY_ACTIONS = new Set(['migrate']);

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
	return (client as { request<TResponse>(path: string, options?: { method?: string; body?: unknown; requireAuth?: boolean }): Promise<TResponse> })
		.request<T>(path, options);
}

function providerSelector(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'provider') ?? 'local';
}

function environmentSelector(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'environment') ?? 'local';
}

function resolveMarket(invocation: TreeseedParsedInvocation) {
	return resolveMarketProfile(stringArg(invocation, 'market') ?? 'local');
}

function resolveCapacityLaunchConfigPath(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const configPath = stringArg(invocation, 'config');
	if (!configPath) return null;
	return resolve(context.cwd, configPath);
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
	return entries.map((entry) => [
		`${recordValue(entry, 'executionProviderKind') ?? 'provider'}:${recordValue(entry, 'nativeUnit') ?? 'native'}`,
		`limit ${formatNumber(recordValue(entry, 'configuredNativeLimit'))}`,
		`observed ${formatNumber(recordValue(entry, 'observedNativeRemaining'))}`,
		`reserved ${formatNumber(recordValue(entry, 'activeReservedNativeAmount'))}`,
		`reserve ${formatNumber(recordValue(entry, 'reserveBufferPercent'))}%`,
		`conversion ${formatNumber(recordValue(entry, 'nativeUnitsPerCredit'))} native/credit`,
		`derived ${formatNumber(recordValue(entry, 'derivedAvailableCredits'))} credits`,
		`confidence ${recordValue(entry, 'confidence') ?? 'unknown'}`,
	].join(' | '));
}

function grantAllocationLines(plan: Record<string, unknown>) {
	const grants = recordValue(plan, 'grants');
	if (!Array.isArray(grants) || grants.length === 0) return [];
	return grants.map((grant) => [
		`${recordValue(grant, 'grantScope') ?? 'grant'} ${recordValue(grant, 'environment') ?? 'all'}`,
		`allocation ${formatNumber(recordValue(grant, 'portfolioAllocationPercent'))}%`,
		`reserve pool ${formatNumber(recordValue(grant, 'reservePoolPercent'))}%`,
		`max daily project credits ${formatNumber(recordValue(grant, 'maxDailyProjectCredits'))}`,
		`overflow ${recordValue(grant, 'overflowPolicy') ?? 'soft_grant'}`,
		`emergency ${recordValue(grant, 'emergencyOverride') === true ? 'on' : 'off'}`,
	].join(' | '));
}

async function runProjectCapacityPlan(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const projectId = stringArg(invocation, 'project');
	if (!projectId) return fail('Missing --project. Use `trsd capacity plan --project <project-id> --environment local`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const environment = environmentSelector(invocation);
	const response = await marketRequest<{ ok: true; payload: Record<string, unknown> }>(
		client,
		`/v1/projects/${encodeURIComponent(projectId)}/capacity-plan?environment=${encodeURIComponent(environment)}`,
		{ requireAuth: true },
	);
	const plan = response.payload;
	return guidedResult({
		command: 'capacity plan',
		summary: `Capacity plan for project ${projectId} in ${environment}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Project', value: projectId },
			{ label: 'Environment', value: environment },
			{ label: 'Derived credits', value: formatNumber(recordValue(recordValue(plan, 'derivedCapacity'), 'totalDerivedAvailableCredits')) },
		],
		sections: [
			{ title: 'Native projection', lines: derivedCapacityLines(plan) },
			{ title: 'Allocation grants', lines: grantAllocationLines(plan) },
		],
		report: { action: 'plan', projectId, environment, market: { id: profile.id, baseUrl: profile.baseUrl }, plan },
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
	const providerList = dryRun
		? { payload: [{ id: providerSelectorValue, name: providerSelectorValue }] }
		: await marketRequest<{ ok: true; payload: unknown[] }>(
			client,
			`/v1/teams/${encodeURIComponent(teamId)}/capacity-providers`,
			{ requireAuth: true },
		);
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
		nativeLimits: [{
			scope,
			nativeUnit,
			limitAmount,
			reserveBufferPercent,
			resetCadence,
			confidence: 'estimated',
			source: 'operator_migration',
		}],
		metadata: {
			source: 'trsd capacity migrate --to-derived',
			staticCreditBudgetsPreservedAs: 'hybrid_fallback_cap',
		},
	};
	const grant = allocationPercent === null ? null : {
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
		summary: dryRun
			? 'Dry run: derived native capacity migration plan.'
			: 'Derived native capacity migration applied.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Provider', value: providerId },
			{ label: 'Native limit', value: `${formatNumber(limitAmount)} ${nativeUnit} / ${scope}` },
			{ label: 'Reserve buffer', value: `${formatNumber(reserveBufferPercent)}%` },
			{ label: 'Allocation percent', value: allocationPercent === null ? null : `${formatNumber(allocationPercent)}%` },
			{ label: 'Dry run', value: dryRun },
		],
		sections: [
			{ title: 'Execution provider', lines: [`${executionProvider.name}: ${kind}, ${nativeUnit}, ${maxConcurrentWorkers} workers, ${quotaVisibility} quota visibility`] },
			...(grant ? [{ title: 'Allocation grant', lines: [`${grant.grantScope} ${projectId ?? teamId} in ${environment}: ${formatNumber(allocationPercent)}%`] }] : []),
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
	const desiredGraph = compileTreeseedDesiredResourceGraph({ tenantRoot: context.cwd, target });
	const selector: TreeseedReconcileSelector = action === 'build'
		? { environment, packageId: ['@treeseed/agent'], resourceKind: ['docker-image-build'] }
		: { environment, packageId: ['@treeseed/agent'], resourceKind: ['capacity-provider', 'local-docker-compose'] };
	const units = compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector);
	const execute = boolArg(invocation, 'execute');
	if (action === 'status' || action === 'logs') {
		const status = await collectTreeseedReconcileStatus({ tenantRoot: context.cwd, target, env: context.env, units, selector });
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Capacity provider ${action} resolved through canonical reconcile status.`,
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Units', value: status.units.length },
				{ label: 'Ready', value: status.ready ? 'yes' : 'no' },
			],
			sections: [
				{ title: action === 'logs' ? 'Log Observations' : 'Units', lines: status.units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.unitId}`) },
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
	const result = action === 'down'
		? (execute
			? await destroyTreeseedTargetUnits({ tenantRoot: context.cwd, target, env: context.env, units, selector, write: (line) => context.write(`[capacity] ${line}`, 'stderr') })
			: await planTreeseedReconciliation({ tenantRoot: context.cwd, target, env: context.env, units, selector }))
		: planOnly
			? await planTreeseedReconciliation({ tenantRoot: context.cwd, target, env: context.env, units, selector })
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
		summary: planOnly
			? `Capacity provider ${action} reconcile plan rendered.`
			: `Capacity provider ${action} reconciled through canonical adapters.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Execute', value: execute ? 'yes' : 'no' },
			...(capacityConfigPath ? [{ label: 'Config', value: capacityConfigPath }] : []),
			{ label: 'Units', value: units.length },
		],
		sections: [
			{ title: 'Units', lines: units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.logicalName}`) },
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
	const desiredGraph = compileTreeseedDesiredResourceGraph({ tenantRoot: context.cwd, target });
	const selector: TreeseedReconcileSelector = { environment: 'local', packageId: ['@treeseed/agent'], resourceKind: ['capacity-provider', 'local-docker-compose'] };
	const units = compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector);
	const status = await collectTreeseedReconcileStatus({ tenantRoot: context.cwd, target, env: context.env, units, selector });
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity provider ${action} is reported through reconcile status; direct provider entrypoint execution has been removed.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Ready', value: status.ready ? 'yes' : 'no' },
		],
		sections: [
			{ title: 'Units', lines: status.units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.unitId}`) },
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
	return fail(`Unknown capacity action "${action}". Use doctor, register, plan, migrate, build, up, down, restart, logs, status, or test-local.`);
};
