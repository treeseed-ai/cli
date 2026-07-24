import { resolve } from 'node:path';
import { resolveMarketProfile } from '@treeseed/sdk/market-client';
import { collectReconcileStatus, destroyTargetUnits, planReconciliation, reconcileTarget, type ReconcileSelector } from '@treeseed/sdk/reconcile';
import { compileDesiredResourceGraph, compileDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { guidedResult } from '../../utilities/utils.js';
import { capacityFlagArg, capacityProviderSelector, capacityStringArg } from './capacity-command-arguments.js';

export const PROVIDER_LIFECYCLE_ACTIONS = new Set(['build', 'up', 'down', 'restart', 'logs', 'status', 'test-local']);
export const PROVIDER_ENTRYPOINT_ACTIONS = new Set(['doctor', 'register', 'plan']);
const CAPACITY_PROVIDER_UNIT_IDS = ['capacity-provider:local', 'local-docker-compose:agent-capacity-provider'];
const CAPACITY_PROVIDER_UNIT_ID_SET = new Set(CAPACITY_PROVIDER_UNIT_IDS);

function capacityProviderUnits<T extends { unitId?: unknown; dependencies?: string[] }>(units: T[]) {
	return units
		.filter((unit) => CAPACITY_PROVIDER_UNIT_ID_SET.has(String(unit.unitId ?? '')))
		.map((unit) => ({
			...unit,
			dependencies: (unit.dependencies ?? []).filter((dependencyId) => CAPACITY_PROVIDER_UNIT_ID_SET.has(dependencyId)),
		}));
}

function resolveMarket(invocation: ParsedInvocation) {
	return resolveMarketProfile(capacityStringArg(invocation, 'market') ?? 'local');
}

function resolveCapacityLaunchConfigPath(invocation: ParsedInvocation, context: CommandContext) {
	const configPath = capacityStringArg(invocation, 'config');
	return configPath ? resolve(context.cwd, configPath) : null;
}

function isNonGitWorkspaceError(error: unknown) {
	return /not a git repository/u.test(error instanceof Error ? error.message : String(error));
}

function nativeBudgetSummaryLines() {
	return [] as string[];
}

const stringArg = capacityStringArg;
const boolArg = capacityFlagArg;
const providerSelector = capacityProviderSelector;

export async function runCapacityLifecycleAction(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const environment = 'local' as const;
	const target = { kind: 'persistent' as const, scope: environment };
	const agentPackageRoot = stringArg(invocation, 'agentPackageRoot');
	const capacityConfigPath = resolveCapacityLaunchConfigPath(invocation, context);
	let desiredGraph: ReturnType<typeof compileDesiredResourceGraph>;
	try {
		desiredGraph = compileDesiredResourceGraph({
			tenantRoot: context.cwd,
			target,
			...(capacityConfigPath ? { capacityConfigPath } : {}),
		});
	} catch (error) {
		if (!agentPackageRoot || !isNonGitWorkspaceError(error)) throw error;
		const execute = boolArg(invocation, 'execute');
		const market = resolveMarket(invocation);
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
	const selector: ReconcileSelector =
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
	const units = action === 'build' ? compileDesiredUnitsFromGraph(desiredGraph, selector) : capacityProviderUnits(compileDesiredUnitsFromGraph(desiredGraph, selector));
	const execute = boolArg(invocation, 'execute');
	if (action === 'status' || action === 'logs') {
		const status = await collectReconcileStatus({
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
	const planMode = boolArg(invocation, 'plan') || !execute;
	const result =
		action === 'down'
			? execute
				? await destroyTargetUnits({
						tenantRoot: context.cwd,
						target,
						env: context.env,
						units,
						selector,
						write: (line) => context.write(`[capacity] ${line}`, 'stderr'),
					})
				: await planReconciliation({
						tenantRoot: context.cwd,
						target,
						env: context.env,
						units,
						selector,
					})
			: planMode
				? await planReconciliation({
						tenantRoot: context.cwd,
						target,
						env: context.env,
						units,
						selector,
					})
				: await reconcileTarget({
						tenantRoot: context.cwd,
						target,
						env: {
							...context.env,
							TREESEED_MARKET_URL: market.baseUrl,
							TREESEED_MARKET_ID: market.id,
							TREESEED_MANAGER_ID: market.id,
							TREESEED_PROVIDER_ENVIRONMENT: providerSelector(invocation),
							...(capacityConfigPath ? { TREESEED_CAPACITY_PROVIDER_MANIFEST: capacityConfigPath } : {}),
						},
						units,
						selector,
						write: (line) => context.write(`[capacity] ${line}`, 'stderr'),
					});
	const blockedPlans = planMode && 'plans' in result && Array.isArray(result.plans)
		? result.plans.filter((entry) => entry.diff.action === 'blocked')
		: [];
	const lifecycleVerified = blockedPlans.length === 0;
	return guidedResult({
		command: `capacity ${action}`,
		summary: planMode
			? lifecycleVerified
				? `Capacity provider ${action} reconcile plan rendered.`
				: `Capacity provider ${action} is blocked by unmet reconciliation prerequisites.`
			: `Capacity provider ${action} reconciled through canonical adapters.`,
		facts: [{ label: 'Market', value: `${market.id} (${market.baseUrl})` }, { label: 'Provider', value: providerSelector(invocation) }, { label: 'Execute', value: execute ? 'yes' : 'no' }, ...(capacityConfigPath ? [{ label: 'Config', value: capacityConfigPath }] : []), { label: 'Units', value: units.length }],
		sections: [
			{
				title: 'Units',
				lines: units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.logicalName}`),
			},
		],
		exitCode: action === 'test-local' && !lifecycleVerified ? 1 : 0,
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

export async function runCapacityProviderEntrypoint(action: string, invocation: ParsedInvocation, context: CommandContext) {
	const market = resolveMarket(invocation);
	const target = { kind: 'persistent' as const, scope: 'local' as const };
	const agentPackageRoot = stringArg(invocation, 'agentPackageRoot');
	let desiredGraph: ReturnType<typeof compileDesiredResourceGraph>;
	try {
		desiredGraph = compileDesiredResourceGraph({
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
	const selector: ReconcileSelector = {
		environment: 'local',
		unitId: CAPACITY_PROVIDER_UNIT_IDS,
	};
	const units = capacityProviderUnits(compileDesiredUnitsFromGraph(desiredGraph, selector));
	const status = await collectReconcileStatus({
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

