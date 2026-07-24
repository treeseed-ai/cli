import { compileHostingGraph, serializeHostingUnit } from '@treeseed/sdk/hosting';
import type { CommandHandler } from '../../types.js';
import { guidedResult } from '../utilities/utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';
import { renderStatusInk } from './status-ui.js';

type Scope = 'local' | 'staging' | 'prod';

const SCOPES: Array<{ id: Scope; label: string }> = [
	{ id: 'local', label: 'Local' },
	{ id: 'staging', label: 'Staging' },
	{ id: 'prod', label: 'Production' },
];

function yesNo(value: boolean) {
	return value ? 'yes' : 'no';
}

function providerSummary(provider: Record<string, any> | undefined) {
	if (!provider) return 'unknown';
	if (provider.applicable === false) return provider.detail ?? 'not applicable';
	const configured = provider.configured ? 'configured' : 'missing';
	if (!provider.live) return configured;
	if (provider.live.skipped) return `${configured}, skipped: ${provider.live.detail}`;
	return `${configured}, ${provider.live.ready ? 'live ok' : `live failed: ${provider.live.detail}`}`;
}

function environmentLines(state: Record<string, any>, scope: Scope) {
	const env = state.environmentStatus?.[scope] ?? state.persistentEnvironments?.[scope] ?? {};
	const providers = state.providerStatus?.[scope] ?? {};
	const blockers = Array.isArray(env.blockers) ? env.blockers : [];
	const warnings = Array.isArray(env.warnings) ? env.warnings : [];
	const providerLines = [
		`GitHub: ${providerSummary(providers.github)}`,
		`Cloudflare: ${providerSummary(providers.cloudflare)}`,
		`Railway: ${providerSummary(providers.railway)}`,
	];
	if (scope === 'local') {
		providerLines.push(`Local development: ${providerSummary(providers.localDevelopment)}`);
	}
	return [
		`Phase: ${env.phase ?? 'pending'}`,
		`Ready: ${yesNo(Boolean(env.ready))}`,
		`Configured: ${yesNo(Boolean(env.configured))}`,
		`Initialized: ${yesNo(Boolean(env.initialized))}`,
		`Provisioned: ${yesNo(Boolean(env.provisioned))}`,
		`Deployable: ${yesNo(Boolean(env.deployable))}`,
		...providerLines,
		`Last deploy: ${env.lastDeploymentTimestamp ?? '(none)'}`,
		`URL: ${env.lastDeployedUrl ?? '(none)'}`,
		...(blockers.length > 0 ? blockers.map((blocker: string) => `BLOCKER: ${blocker}`) : ['Blockers: none']),
		...(warnings.length > 0 ? warnings.map((warning: string) => `WARNING: ${warning}`) : ['Warnings: none']),
	];
}

function statusFacts(state: Record<string, any>, live: boolean) {
	const packageKinds = Array.isArray(state.packageSync?.packages)
		? [...new Set(state.packageSync.packages.map((pkg: any) => pkg.kind).filter(Boolean))].join(', ')
		: '';
	return [
		{ label: 'Mode', value: live ? 'saved state + live provider checks' : 'saved state' },
		{ label: 'Workspace root', value: state.workspaceRoot ? 'yes' : 'no' },
		{ label: 'Tenant config present', value: state.deployConfigPresent ? 'yes' : 'no' },
		{ label: 'Branch', value: state.branchName ?? '(none)' },
		{ label: 'Branch role', value: state.branchRole },
		{ label: 'Mapped environment', value: state.environment },
		{ label: 'Dirty worktree', value: state.dirtyWorktree ? 'yes' : 'no' },
		{ label: 'Package mode', value: state.packageSync.mode },
		{ label: 'Package adapters', value: packageKinds || '(none)' },
		{ label: 'Dependency mode', value: state.packageSync.dependencyMode ?? '(unknown)' },
		{ label: 'Full package checkout', value: state.packageSync.completeCheckout ? 'yes' : 'no' },
		{ label: 'Package branch aligned', value: state.packageSync.aligned ? 'yes' : 'no' },
		{ label: 'Dirty package repos', value: state.packageSync.dirty ? 'yes' : 'no' },
		{ label: 'Package blockers', value: state.packageSync.blockers.length > 0 ? state.packageSync.blockers.join(' | ') : '(none)' },
		{ label: 'Package repairs', value: Array.isArray(state.packageSync.warnings) && state.packageSync.warnings.length > 0 ? state.packageSync.warnings.join(' | ') : '(none)' },
		{ label: 'Preview enabled', value: state.preview.enabled ? 'yes' : 'no' },
		{ label: 'Preview URL', value: state.preview.url ?? '(none)' },
		{ label: 'Remote API auth', value: state.auth.remoteApi ? 'ready' : 'not ready' },
		{ label: 'Wrapped machine key', value: state.secrets.wrappedKeyPresent ? 'present' : 'missing' },
		{ label: 'Key migration', value: state.secrets.migrationRequired ? 'required' : 'not needed' },
		{ label: 'Key agent', value: state.secrets.keyAgentRunning ? (state.secrets.keyAgentUnlocked ? 'running/unlocked' : 'running/locked') : 'stopped' },
		{ label: 'Startup passphrase env', value: state.secrets.startupPassphraseConfigured ? 'configured' : 'unset' },
		{ label: 'Market project', value: state.marketConnection.projectSlug ?? state.marketConnection.projectId ?? '(not paired)' },
		{ label: 'Market team', value: state.marketConnection.teamSlug ?? state.marketConnection.teamId ?? '(not paired)' },
		{ label: 'Market mode', value: state.marketConnection.connectionMode ?? '(not paired)' },
		{ label: 'Hub mode', value: state.marketConnection.hubMode ?? '(unknown)' },
		{ label: 'Runtime mode', value: state.marketConnection.runtimeMode ?? '(unknown)' },
		{ label: 'Runtime registration', value: state.marketConnection.runtimeRegistration ?? '(none)' },
		{ label: 'Runtime ready', value: state.marketConnection.runtimeReady ? 'yes' : 'no' },
		{ label: 'Current workstream', value: state.marketConnection.currentWorkstreamId ?? '(none)' },
		{ label: 'Approval blockers', value: state.marketConnection.approvalBlockers.length > 0 ? state.marketConnection.approvalBlockers.join(' | ') : '(none)' },
	];
}

export const handleStatus: CommandHandler = async (invocation, context) => {
	try {
		const live = invocation.args.live === true;
		const history = invocation.args.history === 'all' ? 'all' : 'recent';
		const result = await createWorkflowSdk(context).status({ live, history });
		const state = result.payload as Record<string, any>;
		let hostingGraph: Record<string, any> | null = null;
		try {
			const graph = compileHostingGraph({
				tenantRoot: context.cwd,
				environment: state.environment === 'prod' || state.environment === 'production'
					? 'prod'
					: state.environment === 'staging'
						? 'staging'
						: 'local',
			});
			hostingGraph = {
				environment: graph.environment,
				placements: graph.placements,
				units: graph.units.map((unit) => serializeHostingUnit(unit)),
			};
			state.hostingGraph = hostingGraph;
		} catch (error) {
			state.hostingGraph = {
				error: error instanceof Error ? error.message : String(error),
			};
		}
		const nextSteps = renderWorkflowNextSteps(result);
		const report = {
			...result,
			state,
			live,
			hostingGraph,
		};
		if (await renderStatusInk(state, context)) {
			return {
				exitCode: 0,
				stdout: [],
				report,
			};
		}
		return guidedResult({
			command: 'status',
			summary: 'Treeseed workflow status',
			facts: statusFacts(state, live),
			sections: [
				...SCOPES.map((scope) => ({
					title: scope.label,
					lines: environmentLines(state, scope.id),
				})),
				{
					title: 'Hosting graph',
					lines: hostingGraph?.placements
						? hostingGraph.placements.map((placement: any) =>
							`${placement.label}: ${placement.serviceIds.join(', ')} on ${placement.hostIds.join(', ')}`)
						: [state.hostingGraph?.error ?? 'No hosting graph available.'],
				},
				{
					title: 'Package adapters',
					lines: Array.isArray(state.packageSync?.packages) && state.packageSync.packages.length > 0
						? state.packageSync.packages.map((pkg: any) =>
							`${pkg.id}: ${pkg.kind}${pkg.version ? ` @ ${pkg.version}` : ''}${pkg.publishTarget ? ` -> ${pkg.publishTarget}` : ''}`)
						: ['No package adapters discovered.'],
				},
				{
					title: 'Managed services',
					lines: Object.entries(state.managedServices ?? {}).map(([name, service]: [string, any]) =>
						`${name}: ${service.enabled ? (service.initialized ? 'deployed' : 'not deployed') : 'disabled'}${service.lastDeployedUrl ? ` (${service.lastDeployedUrl})` : ''}`),
				},
			],
			nextSteps,
			report,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
