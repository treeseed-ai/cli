import {
	runTreeseedLiveReconcileTests,
	type TreeseedLiveReconcileEnvironment,
	type TreeseedLiveReconcileMode,
	type TreeseedLiveReconcileProvider,
} from '@treeseed/sdk/reconcile';
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

export const handleReconcile: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const subcommand = typeof invocation.positionals[0] === 'string' && invocation.positionals[0].trim()
			? invocation.positionals[0].trim()
			: 'status';
		if (subcommand !== 'test-live') {
			throw new Error(`Unknown reconcile subcommand "${subcommand}". Use test-live.`);
		}
		const environment = environmentFor(invocation.args.environment);
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
		const result = await runTreeseedLiveReconcileTests({
			cwd: context.cwd,
			environment,
			providers,
			mode,
			env: resolvedEnv,
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
