import {
	collectTreeseedReconcileStatus,
	destroyTreeseedTargetUnits,
	planTreeseedReconciliation,
	reconcileTreeseedTarget,
	runTreeseedLiveReconcileTests,
	type TreeseedCapacityAcceptanceExecutionInput,
	type TreeseedLiveReconcileEnvironment,
	type TreeseedLiveReconcileMode,
	type TreeseedLiveReconcileProvider,
	type TreeseedReconcileSelector,
	type TreeseedReconcileTarget,
} from '@treeseed/sdk/reconcile';
import { compileTreeseedDesiredResourceGraph, compileTreeseedDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import { collectTreeseedConfigSeedValues } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

function environmentFor(value: unknown): TreeseedLiveReconcileEnvironment {
	return value === 'prod' || value === 'production'
		? 'prod'
		: value === 'staging'
			? 'staging'
			: 'local';
}

function modeFor(value: unknown): TreeseedLiveReconcileMode {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'smoke';
	if (raw === 'smoke' || raw === 'acceptance' || raw === 'cleanup') return raw;
	throw new Error(`Unknown live reconciliation test mode "${raw}". Use smoke, acceptance, or cleanup.`);
}

function providersFor(value: unknown): TreeseedLiveReconcileProvider[] {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'all';
	if (raw === 'all') return ['railway', 'cloudflare', 'github', 'local'];
	const providers = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['railway', 'cloudflare', 'github', 'local']);
	for (const provider of providers) {
		if (!allowed.has(provider)) {
			throw new Error(`Unknown live reconciliation test provider "${provider}". Use railway, cloudflare, github, local, or all.`);
		}
	}
	return [...new Set(providers)] as TreeseedLiveReconcileProvider[];
}

function yesRequested(value: unknown) {
	return value === true || value === 'true' || value === 'yes' || value === '1';
}

function executeRequested(value: unknown) {
	return value === true || value === 'true' || value === 'yes' || value === '1';
}

function targetFor(environment: TreeseedLiveReconcileEnvironment): TreeseedReconcileTarget {
	return { kind: 'persistent', scope: environment };
}

function stringList(value: unknown) {
	if (Array.isArray(value)) {
		return value.flatMap((entry) => stringList(entry));
	}
	if (typeof value !== 'string') return [];
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function selectorFor(args: Record<string, unknown>, environment: TreeseedLiveReconcileEnvironment): TreeseedReconcileSelector | undefined {
	const selector: TreeseedReconcileSelector = { environment };
	const assign = <Key extends keyof TreeseedReconcileSelector>(key: Key, value: unknown) => {
		const values = stringList(value);
		if (values.length > 0) {
			selector[key] = values as TreeseedReconcileSelector[Key];
		}
	};
	assign('unitId', args.unitId ?? args['unit-id']);
	assign('unitType', args.unitType ?? args['unit-type']);
	assign('resourceKind', args.resourceKind ?? args['resource-kind']);
	assign('provider', args.provider);
	assign('packageId', args.packageId ?? args['package-id']);
	assign('serviceId', args.serviceId ?? args['service-id']);
	assign('serviceType', args.serviceType ?? args['service-type']);
	return Object.keys(selector).length > 1 ? selector : undefined;
}

function formatDuration(ms: unknown) {
	const value = typeof ms === 'number' && Number.isFinite(ms) ? ms : 0;
	if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
	if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
	const minutes = Math.floor(value / 60_000);
	const seconds = Math.round((value % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function pad(value: string, width: number) {
	return value.length >= width ? value : `${value}${' '.repeat(width - value.length)}`;
}

function truncate(value: string, width: number) {
	if (value.length <= width) return value;
	if (width <= 1) return value.slice(0, width);
	return `${value.slice(0, width - 1)}…`;
}

function renderScenarioRows(result: Awaited<ReturnType<typeof runTreeseedLiveReconcileTests>>) {
	const rows = result.providers.flatMap((entry) => entry.scenarioResults.map((scenario) => ({
		provider: entry.provider,
		service: scenario.capability,
		status: scenario.ok ? 'ok' : 'blocked',
		lifecycle: scenario.ok && scenario.phase === 'create' ? 'create+verify' : scenario.phase,
		action: scenario.action,
		duration: formatDuration(scenario.durationMs),
		reason: scenario.reason,
	})));
	const width = typeof process.stdout?.columns === 'number' ? process.stdout.columns : 120;
	if (width < 96) {
		return rows.map((row) =>
			`- ${row.provider}:${row.service} ${row.status}; lifecycle=${row.lifecycle}; action=${row.action}; duration=${row.duration}; ${row.reason}`);
	}
	const providerWidth = Math.max('provider'.length, ...rows.map((row) => row.provider.length));
	const serviceWidth = Math.max('service type'.length, ...rows.map((row) => row.service.length));
	const statusWidth = Math.max('status'.length, ...rows.map((row) => row.status.length));
	const lifecycleWidth = Math.max('lifecycle'.length, ...rows.map((row) => row.lifecycle.length));
	const actionWidth = Math.max('action'.length, ...rows.map((row) => row.action.length));
	const durationWidth = Math.max('time'.length, ...rows.map((row) => row.duration.length));
	const fixedWidth = providerWidth + serviceWidth + statusWidth + lifecycleWidth + actionWidth + durationWidth + 18;
	const reasonWidth = Math.max(24, width - fixedWidth);
	const header = [
		pad('provider', providerWidth),
		pad('service type', serviceWidth),
		pad('status', statusWidth),
		pad('lifecycle', lifecycleWidth),
		pad('action', actionWidth),
		pad('time', durationWidth),
		'reason',
	].join('  ');
	const divider = [
		'-'.repeat(providerWidth),
		'-'.repeat(serviceWidth),
		'-'.repeat(statusWidth),
		'-'.repeat(lifecycleWidth),
		'-'.repeat(actionWidth),
		'-'.repeat(durationWidth),
		'-'.repeat(Math.min(reasonWidth, 40)),
	].join('  ');
	return [
		header,
		divider,
		...rows.map((row) => [
			pad(row.provider, providerWidth),
			pad(row.service, serviceWidth),
			pad(row.status, statusWidth),
			pad(row.lifecycle, lifecycleWidth),
			pad(row.action, actionWidth),
			pad(row.duration, durationWidth),
			truncate(row.reason, reasonWidth),
		].join('  ')),
	];
}

function graphSummary(desiredGraph: ReturnType<typeof compileTreeseedDesiredResourceGraph>) {
	const byKind = new Map<string, number>();
	const byProvider = new Map<string, number>();
	for (const resource of desiredGraph.resources) {
		byKind.set(resource.kind, (byKind.get(resource.kind) ?? 0) + 1);
		byProvider.set(resource.provider, (byProvider.get(resource.provider) ?? 0) + 1);
	}
	return {
		workspaceId: desiredGraph.workspaceId,
		environment: desiredGraph.environment,
		packageCount: desiredGraph.packages.length,
		resourceCount: desiredGraph.resources.length,
		resourceKinds: Object.fromEntries([...byKind.entries()].sort(([left], [right]) => left.localeCompare(right))),
		providers: Object.fromEntries([...byProvider.entries()].sort(([left], [right]) => left.localeCompare(right))),
	};
}

function resultSummary(result: Awaited<ReturnType<typeof reconcileTreeseedTarget>>) {
	const units = Array.isArray(result.units) ? result.units : [];
	const plans = Array.isArray(result.plans) ? result.plans : [];
	const results = Array.isArray(result.results) ? result.results : [];
	const timings = Array.isArray(result.timings) ? result.timings : [];
	return {
		unitCount: units.length,
		resultCount: results.length,
		plans: plans.map((plan) => ({
			unitId: plan.unit.unitId,
			unitType: plan.unit.unitType,
			provider: plan.unit.provider,
			logicalName: plan.unit.logicalName,
			action: plan.diff.action,
			reasons: plan.diff.reasons,
		})),
		results: results.map((entry) => ({
			unitId: entry.unit.unitId,
			unitType: entry.unit.unitType,
			provider: entry.unit.provider,
			logicalName: entry.unit.logicalName,
			action: entry.action ?? entry.result?.action ?? 'unknown',
			status: entry.result?.status ?? entry.observed?.status ?? 'unknown',
			warnings: entry.warnings ?? entry.result?.warnings ?? [],
			error: entry.error ?? entry.result?.error ?? null,
		})),
		timings: timings.map((timing) => ({
			name: timing.name,
			durationMs: timing.durationMs,
			status: timing.status,
			metadata: timing.metadata,
		})),
	};
}

export const handleReconcile: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const subcommand = typeof invocation.positionals[0] === 'string' && invocation.positionals[0].trim()
			? invocation.positionals[0].trim()
			: 'status';
		const environment = environmentFor(invocation.args.environment);
		const target = targetFor(environment);
		if (subcommand === 'plan' || subcommand === 'status' || subcommand === 'verify' || subcommand === 'apply' || subcommand === 'destroy') {
			const resolvedEnv = {
				...context.env,
				...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
			};
			const desiredGraph = compileTreeseedDesiredResourceGraph({ tenantRoot: context.cwd, target });
			const selector = selectorFor(invocation.args, environment);
			const desiredUnits = compileTreeseedDesiredUnitsFromGraph(desiredGraph, selector);
			if (subcommand === 'plan') {
				const planned = await planTreeseedReconciliation({ tenantRoot: context.cwd, target, env: resolvedEnv, units: desiredUnits });
				const actions = planned.plans.map((plan) => ({
					unitId: plan.unit.unitId,
					unitType: plan.unit.unitType,
					provider: plan.unit.provider,
					logicalName: plan.unit.logicalName,
					action: plan.diff.action,
					reasons: plan.diff.reasons,
				}));
				return guidedResult({
					command: 'reconcile plan',
					summary: `Reconcile plan resolved ${actions.length} unit${actions.length === 1 ? '' : 's'} for ${environment}.`,
					facts: [
						{ label: 'Environment', value: environment },
						{ label: 'Resources', value: desiredGraph.resources.length },
						{ label: 'Packages', value: desiredGraph.packages.length },
					],
					sections: [{
						title: 'Actions',
						lines: actions.map((action) => `${action.provider}:${action.unitType} ${action.logicalName} -> ${action.action}`),
					}],
					report: { target, desiredGraph: graphSummary(desiredGraph), actions },
				});
			}
			if (subcommand === 'status' || subcommand === 'verify') {
				const status = await collectTreeseedReconcileStatus({ tenantRoot: context.cwd, target, env: resolvedEnv, units: desiredUnits });
				return guidedResult({
					command: `reconcile ${subcommand}`,
					summary: status.ready
						? `Reconcile ${subcommand} is ready for ${environment}.`
						: `Reconcile ${subcommand} found ${status.blockers.length} blocker${status.blockers.length === 1 ? '' : 's'} for ${environment}.`,
					facts: [
						{ label: 'Environment', value: environment },
						{ label: 'Ready', value: status.ready ? 'yes' : 'no' },
						{ label: 'Units', value: status.units.length },
						{ label: 'Resources', value: desiredGraph.resources.length },
					],
					sections: [{
						title: 'Units',
						lines: status.units.map((unit) => `${unit.provider}:${unit.unitType} ${unit.unitId} ${unit.verification?.verified ? 'verified' : 'unverified'}`),
					}, {
						title: 'Blockers',
						lines: status.blockers,
					}],
					report: { target, desiredGraph: graphSummary(desiredGraph), status },
					exitCode: status.ready ? 0 : 1,
				});
			}
			if (subcommand === 'apply') {
				const result = await reconcileTreeseedTarget({
					tenantRoot: context.cwd,
					target,
					env: resolvedEnv,
					units: desiredUnits,
					planOnly: false,
					write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
				});
				return guidedResult({
					command: 'reconcile apply',
					summary: `Reconciled ${result.results.length} unit${result.results.length === 1 ? '' : 's'} for ${environment}.`,
					facts: [
						{ label: 'Environment', value: environment },
						{ label: 'Units', value: result.units.length },
						{ label: 'Results', value: result.results.length },
					],
					sections: [{
						title: 'Actions',
						lines: result.plans.map((plan) => `${plan.unit.provider}:${plan.unit.unitType} ${plan.unit.logicalName} -> ${plan.diff.action}`),
					}],
					report: { target, desiredGraph: graphSummary(desiredGraph), result: resultSummary(result) },
				});
			}
			if (subcommand === 'destroy') {
				if (!executeRequested(invocation.args.execute)) {
					throw new Error('Reconcile destroy mutates provider resources. Re-run with --execute to confirm.');
				}
				const result = await destroyTreeseedTargetUnits({
					tenantRoot: context.cwd,
					target,
					env: resolvedEnv,
					units: desiredUnits,
					write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
				});
				return guidedResult({
					command: 'reconcile destroy',
					summary: `Destroyed ${result.results.length} reconcile unit${result.results.length === 1 ? '' : 's'} for ${environment}.`,
					facts: [
						{ label: 'Environment', value: environment },
						{ label: 'Results', value: result.results.length },
					],
					report: { target, desiredGraph: graphSummary(desiredGraph), result: resultSummary(result as Awaited<ReturnType<typeof reconcileTreeseedTarget>>) },
				});
			}
		}
		if (subcommand !== 'test-live') {
			throw new Error(`Unknown reconcile subcommand "${subcommand}". Use plan, status, verify, apply, destroy, or test-live.`);
		}
		const providers = providersFor(invocation.args.provider);
		const mode = modeFor(invocation.args.mode);
		if ((mode === 'acceptance' || mode === 'cleanup') && !yesRequested(invocation.args.yes)) {
			throw new Error(`Live reconciliation ${mode} mode creates or deletes real provider resources. Re-run with --yes to confirm.`);
		}
		const resolvedEnv = {
			...context.env,
			...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
		};
		const shouldStreamProgress = mode !== 'smoke';
		const capacityAssignmentExecutor = environment === 'local' && providers.includes('local') && mode !== 'smoke'
			? async (input: TreeseedCapacityAcceptanceExecutionInput) => {
				const { executeDeterministicCapacityAcceptance } = await import('@treeseed/agent/provider-acceptance');
				return executeDeterministicCapacityAcceptance({ ...input, cwd: context.cwd, env: resolvedEnv });
			}
			: undefined;
		const result = await runTreeseedLiveReconcileTests({
			cwd: context.cwd,
			environment,
			providers,
			mode,
			env: resolvedEnv,
			capacityAssignmentExecutor,
			onProgress: shouldStreamProgress
				? (event) => {
						const elapsed = typeof event.elapsedMs === 'number' ? ` (${formatDuration(event.elapsedMs)})` : '';
						context.write(`[reconcile] ${event.message}${elapsed}`, 'stderr');
					}
				: undefined,
		});
		const blocked = result.providers.flatMap((entry) =>
			entry.report.blockedDrift.map((drift) => `${entry.provider}: ${drift.reason}`));
		return guidedResult({
			command: 'reconcile test-live',
			summary: result.ok
				? `Live reconciliation ${mode} tests passed for ${providers.join(', ')}.`
				: `Live reconciliation ${mode} tests found blocking drift for ${providers.join(', ')}.`,
			facts: [
				{ label: 'Mode', value: mode },
				{ label: 'Environment', value: environment },
				{ label: 'Run ID', value: result.runId },
				{ label: 'Resource prefix', value: result.resourcePrefix },
				{ label: 'Providers', value: providers.join(', ') },
				{ label: 'OK', value: result.ok ? 'yes' : 'no' },
			],
			sections: [{
				title: 'Providers',
				lines: result.providers.map((entry) =>
					`${entry.provider}: ${entry.ok ? 'ok' : `${entry.report.blockedDrift.length} blocked`} (${entry.coverage.passed}/${entry.coverage.total})`),
			}, {
				title: 'Service Type Results',
				lines: renderScenarioRows(result),
			}],
			report: result,
			exitCode: result.ok ? 0 : 1,
			stderr: blocked,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
