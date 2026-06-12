import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveCapacityProviderLaunchEnvironment } from '@treeseed/sdk/capacity-provider';
import { resolveMarketProfile } from '@treeseed/sdk/market-client';
import { findNearestTreeseedRoot, findNearestTreeseedWorkspaceRoot } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandContext, TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';

const ENTRYPOINT_RELATIVE_PATH = ['dist', 'provider', 'entrypoint.js'] as const;
const COMPOSE_FILE_NAME = 'compose.capacity-provider.yml';
const DEFAULT_PROJECT_NAME = 'treeseed-capacity-provider';
const DEFAULT_HOST_DATA_DIR = '.treeseed/local-capacity-provider/data';
const PROVIDER_LIFECYCLE_ACTIONS = new Set(['build', 'up', 'down', 'restart', 'logs', 'status', 'test-local']);
const PROVIDER_ENTRYPOINT_ACTIONS = new Set(['doctor', 'register', 'plan']);
const MARKET_CAPACITY_ACTIONS = new Set(['migrate']);

type AgentPackageResolution = {
	packageRoot: string;
	entrypointPath: string;
	composeFilePath: string;
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

function readPackageName(packageRoot: string) {
	const packageJsonPath = resolve(packageRoot, 'package.json');
	if (!existsSync(packageJsonPath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
		return parsed.name ?? null;
	} catch {
		return null;
	}
}

function agentEntrypoint(packageRoot: string) {
	return resolve(packageRoot, ...ENTRYPOINT_RELATIVE_PATH);
}

function resolveAgentPackageRoot(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext): string | null {
	const explicitRoot = stringArg(invocation, 'agentPackageRoot');
	if (explicitRoot) {
		return resolve(context.cwd, explicitRoot);
	}
	if (readPackageName(context.cwd) === '@treeseed/agent') {
		return context.cwd;
	}
	const workspaceRoot = findNearestTreeseedWorkspaceRoot(context.cwd);
	const workspaceAgentRoot = workspaceRoot ? resolve(workspaceRoot, 'packages', 'agent') : null;
	if (workspaceAgentRoot && existsSync(resolve(workspaceAgentRoot, 'package.json'))) {
		return workspaceAgentRoot;
	}
	const nearestProjectRoot = findNearestTreeseedRoot(context.cwd);
	const projectAgentRoot = nearestProjectRoot ? resolve(nearestProjectRoot, 'packages', 'agent') : null;
	if (projectAgentRoot && existsSync(resolve(projectAgentRoot, 'package.json'))) {
		return projectAgentRoot;
	}
	const installedRoot = resolve(context.cwd, 'node_modules', '@treeseed', 'agent');
	if (existsSync(resolve(installedRoot, 'package.json'))) {
		return installedRoot;
	}
	return null;
}

function resolveAgentPackage(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext, options: { requireEntrypoint?: boolean } = {}): AgentPackageResolution {
	const packageRoot = resolveAgentPackageRoot(invocation, context);
	if (!packageRoot) {
		throw new Error(
			'Unable to locate @treeseed/agent. Build the workspace package, install @treeseed/agent, or pass --agent-package-root.',
		);
	}
	const entrypointPath = agentEntrypoint(packageRoot);
	if (options.requireEntrypoint !== false && !existsSync(entrypointPath)) {
		throw new Error(
			`Missing provider runtime at ${entrypointPath}. Run npm -w packages/agent run build:dist or pass --agent-package-root to a built package.`,
		);
	}
	const composeFilePath = resolve(packageRoot, COMPOSE_FILE_NAME);
	return { packageRoot, entrypointPath, composeFilePath };
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

function resolveTenantRoot(context: TreeseedCommandContext, agentPackageRoot: string) {
	return findNearestTreeseedRoot(context.cwd) ?? (readPackageName(agentPackageRoot) === '@treeseed/agent' ? agentPackageRoot : context.cwd);
}

function defaultHostDataDir(context: TreeseedCommandContext) {
	const tenantRoot = findNearestTreeseedRoot(context.cwd) ?? context.cwd;
	return resolve(tenantRoot, DEFAULT_HOST_DATA_DIR);
}

function providerProjectName(invocation: TreeseedParsedInvocation) {
	const provider = providerSelector(invocation).replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'local';
	return `${DEFAULT_PROJECT_NAME}-${provider}`;
}

function composeCommandArgs(composeFilePath: string, projectName: string, action: string) {
	const base = ['compose', '-f', composeFilePath, '-p', projectName];
	switch (action) {
		case 'up':
			return [...base, 'up', '-d'];
		case 'down':
			return [...base, 'down'];
		case 'restart':
			return [...base, 'restart'];
		case 'logs':
			return [...base, 'logs', '--tail', '200'];
		case 'status':
			return [...base, 'ps'];
		default:
			return base;
	}
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

function lifecycleActionRequiresConnection(action: string) {
	return action === 'up' || action === 'restart';
}

function runLifecycleAction(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const agentPackage = resolveAgentPackage(invocation, context, { requireEntrypoint: action !== 'build' });
	if (action !== 'build' && action !== 'test-local' && !existsSync(agentPackage.composeFilePath)) {
		return fail(`Missing ${COMPOSE_FILE_NAME} in ${agentPackage.packageRoot}. Build or reinstall @treeseed/agent with Phase 3 container assets.`);
	}
	if (action === 'build' || action === 'test-local') {
		const script = action === 'build' ? 'capacity-provider:build' : 'capacity-provider:test-local';
		const result = context.spawn('npm', ['run', script], {
			cwd: agentPackage.packageRoot,
			env: context.env,
			stdio: 'inherit',
		});
		return guidedResult({
			command: `capacity ${action}`,
			summary: result.status === 0
				? `Capacity provider ${action === 'build' ? 'image build' : 'container smoke test'} completed.`
				: `Capacity provider ${action === 'build' ? 'image build' : 'container smoke test'} failed.`,
			facts: [
				{ label: 'Agent package', value: agentPackage.packageRoot },
				{ label: 'Script', value: script },
				{ label: 'Exit code', value: result.status ?? 1 },
			],
			exitCode: result.status ?? 1,
			report: {
				action,
				agentPackageRoot: agentPackage.packageRoot,
				script,
			},
		});
	}
	const diagnostic = boolArg(invocation, 'diagnostic') || action === 'test-local';
	const market = resolveMarket(invocation);
	const hostDataDirInput = stringArg(invocation, 'dataDir') ?? context.env.TREESEED_PROVIDER_HOST_DATA_DIR ?? defaultHostDataDir(context);
	const resolvedHostDataDir = resolve(context.cwd, hostDataDirInput);
	const tenantRoot = resolveTenantRoot(context, agentPackage.packageRoot);
	const launch = resolveCapacityProviderLaunchEnvironment({
		tenantRoot,
		scope: environmentSelector(invocation),
		env: context.env,
		diagnostic,
		requireConnection: lifecycleActionRequiresConnection(action),
		overrides: {
			TREESEED_MARKET_URL: market.baseUrl,
			TREESEED_MANAGER_ID: market.id,
			TREESEED_PROVIDER_HOST_DATA_DIR: resolvedHostDataDir,
			TREESEED_PROVIDER_ENVIRONMENT: providerSelector(invocation),
			...(diagnostic ? { TREESEED_PROVIDER_STARTUP_MODE: 'diagnostic' } : {}),
		},
	});
	const hostDataDir = resolvedHostDataDir;
	mkdirSync(hostDataDir, { recursive: true });
	const projectName = providerProjectName(invocation);
	const args = composeCommandArgs(agentPackage.composeFilePath, projectName, action);
	const result = context.spawn('docker', args, {
		cwd: agentPackage.packageRoot,
		env: {
			...context.env,
			...launch.env,
		},
		stdio: 'inherit',
	});
	return guidedResult({
		command: `capacity ${action}`,
		summary: result.status === 0
			? `Capacity provider ${action} completed${diagnostic ? ' in diagnostic mode' : ''}.`
			: `Capacity provider ${action} failed.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Mode', value: diagnostic ? 'diagnostic' : 'live' },
			{ label: 'Compose project', value: projectName },
			{ label: 'Agent package', value: agentPackage.packageRoot },
			{ label: 'Data directory', value: hostDataDir },
			{ label: 'Exit code', value: result.status ?? 1 },
		],
		sections: [
			{
				title: 'Environment',
				lines: Object.entries(launch.redactedEnv)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, value]) => `${key}=${value}`),
			},
		],
		exitCode: result.status ?? 1,
		report: {
			action,
			agentPackageRoot: agentPackage.packageRoot,
			composeFile: agentPackage.composeFilePath,
			composeProject: projectName,
			market: { id: market.id, baseUrl: market.baseUrl },
			provider: providerSelector(invocation),
			diagnostic,
			redactedEnv: launch.redactedEnv,
		},
	});
}

function invokeProviderEntrypoint(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const agentPackage = resolveAgentPackage(invocation, context);
	const market = resolveMarket(invocation);
	const args = [agentPackage.entrypointPath, action, '--market', market.id, '--provider', providerSelector(invocation)];
	if (boolArg(invocation, 'dryRun') || action === 'doctor' || action === 'plan') {
		args.push('--dry-run');
	}
	if (context.outputFormat === 'json' || boolArg(invocation, 'json')) {
		args.push('--json');
	}
	const result = spawnSync(process.execPath, args, {
		cwd: agentPackage.packageRoot,
		env: {
			...context.env,
			TREESEED_MARKET_URL: market.baseUrl,
			TREESEED_MANAGER_ID: market.id,
			TREESEED_PROVIDER_ENVIRONMENT: providerSelector(invocation),
		},
		encoding: 'utf8',
	});
	const stdout = result.stdout.trim();
	const stderr = result.stderr.trim();
	let report: Record<string, unknown> | null = null;
	if (stdout.startsWith('{')) {
		try {
			report = JSON.parse(stdout) as Record<string, unknown>;
		} catch {
			report = null;
		}
	}
	if (context.outputFormat === 'json') {
		return {
			exitCode: result.status ?? 1,
			stdout: stdout ? [stdout] : [],
			stderr: stderr ? [stderr] : [],
			report: report ?? {
				ok: result.status === 0,
				action,
				stdout,
				stderr,
				agentPackageRoot: agentPackage.packageRoot,
			},
		};
	}
	return guidedResult({
		command: `capacity ${action}`,
		summary: result.status === 0 ? `Capacity provider ${action} completed.` : `Capacity provider ${action} failed.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Agent package', value: agentPackage.packageRoot },
			{ label: 'Exit code', value: result.status ?? 1 },
		],
		sections: [
			{ title: 'Output', lines: stdout ? stdout.split(/\r?\n/u) : [] },
			{ title: 'Native budget file', lines: nativeBudgetSummaryLines(report) },
			{ title: 'Errors', lines: stderr ? stderr.split(/\r?\n/u) : [] },
		],
		exitCode: result.status ?? 1,
		report: report ?? {
			ok: result.status === 0,
			action,
			agentPackageRoot: agentPackage.packageRoot,
		},
	});
}

export const handleCapacity: TreeseedCommandHandler = (invocation, context) => {
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
			return runLifecycleAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (PROVIDER_ENTRYPOINT_ACTIONS.has(action)) {
		try {
			return invokeProviderEntrypoint(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	return fail(`Unknown capacity action "${action}". Use doctor, register, plan, migrate, build, up, down, restart, logs, status, or test-local.`);
};
