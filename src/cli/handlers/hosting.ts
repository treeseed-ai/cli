import {
	compileTreeseedHostingGraph,
	planTreeseedHostingGraph,
	serializeHostingPlan,
	serializeHostingUnit,
	type TreeseedHostingEnvironment,
} from '@treeseed/sdk/hosting';
import {
	collectTreeseedReconcileStatus,
	destroyTreeseedTargetUnits,
	reconcileTreeseedTarget,
	type TreeseedReconcileSelector,
	type TreeseedReconcileTarget,
} from '@treeseed/sdk/reconcile';
import {
	collectTreeseedConfigSeedValues,
	collectTreeseedLiveHostedServiceChecks as collectLiveChecks,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

function environmentFor(value: unknown): TreeseedHostingEnvironment {
	return value === 'prod' || value === 'production'
		? 'prod'
		: value === 'staging'
			? 'staging'
			: 'local';
}

function subcommandFor(value: unknown) {
	const subcommand = typeof value === 'string' && value.trim() ? value.trim() : 'status';
	if (!['plan', 'apply', 'verify', 'status', 'destroy'].includes(subcommand)) {
		throw new Error(`Unknown hosting subcommand "${subcommand}". Use plan, apply, verify, status, or destroy.`);
	}
	return subcommand as 'plan' | 'apply' | 'verify' | 'status' | 'destroy';
}

function listArg(value: unknown) {
	const raw = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
	return [...new Set(raw.flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean))];
}

function renderUnitLine(entry: { unit: ReturnType<typeof serializeHostingUnit>; plan?: { action?: string }; verification?: { verified?: boolean } }) {
	return `${entry.unit.id}: ${entry.unit.serviceType} -> ${entry.unit.hostId} (${entry.unit.placement})${entry.plan?.action ? ` ${entry.plan.action}` : ''}${entry.verification ? ` verified=${entry.verification.verified ? 'yes' : 'no'}` : ''}`;
}

function targetFor(environment: TreeseedHostingEnvironment): TreeseedReconcileTarget {
	return { kind: 'persistent', scope: environment };
}

function selectorFromHostingGraph(graph: ReturnType<typeof compileTreeseedHostingGraph>): TreeseedReconcileSelector {
	const includesApi = graph.units.some((unit) => unit.id === 'api' || unit.config.serviceName === 'treeseed-api');
	const exactServiceIds = [...new Set(graph.units.flatMap((unit) => [
		unit.id,
		typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
		!['api', 'operationsRunner', 'capacityProviderApi', 'capacityProviderManager', 'capacityProviderRunner'].includes(unit.id)
			? unit.id
			: null,
	]).filter((value): value is string => Boolean(value)))];
	return {
		host: [...new Set([
			...graph.units.map((unit) => unit.host.id),
			...(includesApi ? ['cloudflare-dns'] : []),
		].filter((hostId) => hostId !== 'smtp' && hostId !== 'local-process' && hostId !== 'local-docker'))],
		serviceId: exactServiceIds,
		serviceType: [...new Set(graph.units.flatMap((unit) => {
			if (unit.id === 'api') return ['api-runtime', 'railway-service:api', 'custom-domain:api', 'dns-record'];
			if (unit.id === 'operationsRunner') return ['operations-runner-runtime', 'railway-service:operations-runner'];
			if (unit.placement === 'runner-capacity') return ['api-runtime', 'operations-runner-runtime', 'railway-service:api', 'railway-service:operations-runner'];
			if (unit.host.id === 'cloudflare') return ['web-ui', 'edge-worker', 'content-store', 'queue', 'database', 'kv-form-guard', 'turnstile-widget', 'pages-project', 'custom-domain:web', 'dns-record'];
			return [];
		}))],
	};
}

function selectedSeedEnv(context: Parameters<TreeseedCommandHandler>[1], environment: TreeseedHostingEnvironment) {
	return {
		...context.env,
		...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
	};
}

export const handleHosting: TreeseedCommandHandler = async (invocation, context) => {
		try {
			const subcommand = subcommandFor(invocation.positionals[0]);
			const environment = environmentFor(invocation.args.environment);
			const dryRun = invocation.args.dryRun !== false && invocation.args.execute !== true;
			const appId = typeof invocation.args.app === 'string' && invocation.args.app.trim()
				? invocation.args.app.trim()
				: undefined;
			const env = selectedSeedEnv(context, environment);
			const filter = {
				serviceIds: listArg(invocation.args.service),
				placements: listArg(invocation.args.placement) as any,
				hosts: listArg(invocation.args.host),
		};
		const filterInput = filter.serviceIds.length || filter.placements.length || filter.hosts.length
			? { filter }
			: {};

			if (subcommand === 'status') {
				const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
				const units = graph.units.map((unit) => serializeHostingUnit(unit));
				return guidedResult({
				command: 'hosting status',
				summary: `Hosting graph status for ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
					{ label: 'Application', value: appId ?? '(workspace)' },
					{ label: 'Units', value: String(units.length) },
					{ label: 'Hosts', value: Object.keys(graph.hosts).join(', ') },
					{ label: 'Service types', value: Object.keys(graph.serviceTypes).join(', ') },
				],
				sections: [
					{
						title: 'Placements',
						lines: graph.placements.map((placement) =>
							`${placement.label}: ${placement.serviceIds.join(', ')} on ${placement.hostIds.join(', ')}`),
					},
					{
						title: 'Units',
						lines: units.map((unit) => renderUnitLine({ unit })),
					},
				],
				report: {
					command: 'hosting status',
					environment,
					graph: {
						environment,
						appId: appId ?? null,
						applications: graph.applications?.map((app) => ({
							id: app.id,
							relativeRoot: app.relativeRoot,
							roles: app.roles,
						})) ?? [],
						placements: graph.placements,
						units,
						warnings: graph.warnings,
					},
				},
			});
		}

		if (subcommand === 'destroy') {
			if (!appId) {
				throw new Error('hosting destroy requires --app so the teardown boundary is explicit.');
			}
				const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
			const selector = selectorFromHostingGraph(graph);
			const result = dryRun
				? { target: targetFor(environment), results: graph.units.map((unit) => ({ unit: serializeHostingUnit(unit), action: 'destroy', dryRun: true })) }
				: await destroyTreeseedTargetUnits({
					tenantRoot: context.cwd,
					target: targetFor(environment),
						env,
					selector,
					write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
				});
			return guidedResult({
				command: 'hosting destroy',
				summary: `${dryRun ? 'Planned' : 'Destroyed'} hosting resources for ${appId} in ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
					{ label: 'Application', value: appId },
					{ label: 'Dry run', value: dryRun ? 'yes' : 'no' },
					{ label: 'Selected units', value: graph.units.length },
				],
				sections: [
					{
						title: 'Units',
						lines: graph.units.length
							? graph.units.map((unit) => `${unit.id}: destroy`)
							: ['No hosting units selected.'],
					},
				],
				report: {
					command: 'hosting destroy',
					environment,
					appId,
					dryRun,
					result,
				},
			});
		}

			if (subcommand === 'plan' || subcommand === 'verify') {
				const plan = await planTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, dryRun: true, env, ...filterInput });
				const report = serializeHostingPlan(plan);
			const planFailures = report.ok === false || report.liveVerification?.ok === false
				? report.units
					.filter((entry) => entry.verification?.verified !== true)
					.flatMap((entry) => entry.verification?.checks
						?.filter((check) => check.ok === false)
						.flatMap((check) => check.issues.length > 0
							? check.issues.map((issue) => `${entry.unit.id}:${check.key}: ${issue}`)
							: [`${entry.unit.id}:${check.key}: failed`]) ?? [`${entry.unit.id}: verification failed`])
				: [];
			const liveHostedServices = planFailures.length === 0 && subcommand === 'verify' && invocation.args.live === true && environment !== 'local'
					? await collectLiveChecks({
						tenantRoot: context.cwd,
						target: environment,
						appId,
						serviceKeys: filter.serviceIds,
						strict: true,
						requireLiveRailway: !appId || appId === 'api',
						requireLiveHttp: true,
						env,
					})
					: null;
			const liveFailures = liveHostedServices
				? [
					...liveHostedServices.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
					...liveHostedServices.liveObservation.issues,
				]
				: [];
			return guidedResult({
				command: `hosting ${subcommand}`,
				summary: `${subcommand === 'verify' ? 'Verified' : 'Planned'} hosting graph for ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
					{ label: 'Application', value: appId ?? '(workspace)' },
					{ label: 'Dry run', value: 'yes' },
					{ label: 'Units', value: String(report.units.length) },
					{ label: 'Verified units', value: String(report.units.filter((entry) => entry.verification.verified).length) },
				],
				sections: [
					{
						title: 'Placements',
						lines: report.placements.map((placement) =>
							`${placement.label}: ${placement.serviceIds.join(', ')} on ${placement.hostIds.join(', ')}`),
					},
					{
						title: 'Plan',
						lines: report.units.map((entry) => renderUnitLine(entry)),
					},
				],
				report: liveHostedServices ? { ...report, hostedServices: liveHostedServices } : report,
				exitCode: planFailures.length > 0 || liveFailures.length > 0 ? 1 : 0,
				stderr: [...planFailures, ...liveFailures],
			});
		}

			const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
			const plan = await planTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, dryRun: true, env, ...filterInput });
			const planReport = serializeHostingPlan(plan);
		const selector = selectorFromHostingGraph(graph);
		const reconcileResult = dryRun
				? null
				: await reconcileTreeseedTarget({
					tenantRoot: context.cwd,
					target: targetFor(environment),
					env,
					selector,
					dryRun: false,
					write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
				});
		let status = dryRun
				? null
				: await collectTreeseedReconcileStatus({
					tenantRoot: context.cwd,
					target: targetFor(environment),
					env,
					selector,
				});
		const report = {
			...planReport,
			dryRun,
			selector,
			results: planReport.units.map((entry) => ({
				unit: entry.unit,
				plan: entry.plan,
				verification: entry.verification,
				reconcile: reconcileResult?.results.find((result) => result.unit.logicalName === entry.unit.id || result.unit.unitId.includes(entry.unit.id)) ?? null,
			})),
			reconcile: reconcileResult,
			status,
			ok: status ? status.ready : true,
		};
		const liveHostedServices = !dryRun && environment !== 'local'
				? await collectLiveChecks({
					tenantRoot: context.cwd,
					target: environment,
					appId,
					serviceKeys: filter.serviceIds,
					strict: true,
					requireLiveRailway: !appId || appId === 'api',
					requireLiveHttp: true,
					env,
				})
				: null;
		const liveFailures = liveHostedServices
			? [
				...liveHostedServices.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
				...liveHostedServices.liveObservation.issues,
			]
			: [];
			if (!dryRun && status?.ready === false && liveHostedServices && liveFailures.length === 0) {
				status = await collectTreeseedReconcileStatus({
					tenantRoot: context.cwd,
					target: targetFor(environment),
					env,
					selector,
				});
			report.status = status;
			report.ok = status.ready;
		}
		const finalReport = liveHostedServices
			? {
				...report,
				liveVerification: {
					ok: liveFailures.length === 0,
					source: 'live-hosted-service-checks',
					checkedAt: new Date().toISOString(),
					issues: liveFailures,
					checks: liveHostedServices.checks,
				},
				hostedServices: liveHostedServices,
				ok: report.ok === true && liveFailures.length === 0,
			}
			: report;
		return guidedResult({
			command: 'hosting apply',
			summary: `${dryRun ? 'Dry-run applied' : 'Applied'} hosting graph for ${environment}`,
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Application', value: appId ?? '(workspace)' },
				{ label: 'Dry run', value: dryRun ? 'yes' : 'no' },
				{ label: 'Units', value: String(finalReport.results.length) },
				{ label: 'Verified units', value: String(finalReport.results.filter((entry) => entry.verification.verified).length) },
				{ label: 'Selected systems', value: finalReport.selectedSystems?.join(', ') || '(none)' },
				{ label: 'Railway reconcile', value: finalReport.transport?.railway?.reconcile ?? '(not selected)' },
				{ label: 'Railway deploy', value: finalReport.transport?.railway?.deploy ?? '(not selected)' },
				{ label: 'Live verification', value: finalReport.liveVerification?.ok === false ? 'failed' : 'passed' },
			],
			sections: [
				{
					title: 'Results',
					lines: finalReport.results.map((entry) => renderUnitLine({
						unit: entry.unit,
						plan: entry.plan,
						verification: entry.verification,
					})),
				},
			],
			report: finalReport,
			exitCode: !dryRun && (liveFailures.length > 0 || finalReport.ok === false) ? 1 : 0,
			stderr: liveFailures,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
