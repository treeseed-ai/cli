import {
	compileTreeseedHostingGraph,
	planTreeseedHostingGraph,
	serializeHostingPlan,
	serializeHostingUnit,
} from '@treeseed/sdk/hosting';
import {
	collectTreeseedReconcileStatus,
	destroyTreeseedTargetUnits,
	reconcileTreeseedTarget,
} from '@treeseed/sdk/reconcile';
import {
	collectTreeseedLiveHostedServiceChecks as collectLiveChecks,
	configuredRailwayServices,
	waitForRailwayManagedDeploymentsSettled,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';
import {
	environmentFor,
	hostingReportWithReadOnlyStatus,
	listArg,
	reconcilePlanFailures,
	renderReconcilePlanLine,
	renderUnitLine,
	selectedSeedEnv,
	selectorFromHostingGraph,
	serializeReconcilePlan,
	stripLegacyPlanningFields,
	subcommandFor,
	targetFor,
} from './hosting-support.js';

export const handleHosting: TreeseedCommandHandler = async (invocation, context) => {
		try {
			const subcommand = subcommandFor(invocation.positionals[0]);
			const environment = environmentFor(invocation.args.environment);
			if (invocation.args.planOnly === true) {
				throw new Error('hosting planning is available only through `hosting plan`; hosted verification and apply commands always use real provider state.');
			}
			const appId = typeof invocation.args.app === 'string' && invocation.args.app.trim()
				? invocation.args.app.trim()
				: undefined;
			const replacePendingVolumes = invocation.args.replacePendingVolumes === true;
			if (replacePendingVolumes && subcommand !== 'apply') {
				throw new Error('--replace-pending-volumes is available only with `hosting apply`.');
			}
			if (replacePendingVolumes && invocation.args.yes !== true) {
				throw new Error('--replace-pending-volumes permanently discards queued Railway volume data and requires --yes.');
			}
			const env = {
				...selectedSeedEnv(context, environment),
				...(replacePendingVolumes ? { TREESEED_REPLACE_PENDING_RAILWAY_VOLUMES: '1' } : {}),
			};
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
			const result = await destroyTreeseedTargetUnits({
					tenantRoot: context.cwd,
					target: targetFor(environment),
						env,
					selector,
					write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
				});
			return guidedResult({
				command: 'hosting destroy',
				summary: `Destroyed hosting resources for ${appId} in ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
					{ label: 'Application', value: appId },
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
					result: stripLegacyPlanningFields(result),
				},
			});
		}

			if (subcommand === 'plan' && invocation.args.live === true) {
				return guidedResult({
					command: 'hosting plan',
					summary: 'Hosting plan is not a live verification command. Use `trsd hosting verify --live` to check provider state.',
					facts: [
						{ label: 'Environment', value: environment },
						{ label: 'Application', value: appId ?? '(workspace)' },
					],
					sections: [],
					report: {
						command: 'hosting plan',
						environment,
						appId,
						ok: false,
						liveVerification: {
							ok: false,
							source: 'hosting-plan',
							checkedAt: new Date().toISOString(),
							issues: ['hosting plan cannot prove live provider state'],
							checks: [],
						},
					},
					exitCode: 1,
					stderr: ['hosting plan cannot prove live provider state; use hosting verify --live'],
				});
			}

			if (subcommand === 'plan' || subcommand === 'verify') {
				const plan = await planTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
				const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
				const selector = selectorFromHostingGraph(graph);
				const reconcilePlan = subcommand === 'plan' && invocation.args.placementOnly !== true
					? await reconcileTreeseedTarget({
						tenantRoot: context.cwd,
						target: targetFor(environment),
						env,
						selector,
						planOnly: true,
						write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
					})
					: null;
				const liveStatus = subcommand === 'verify' && invocation.args.live === true && environment !== 'local'
					? await collectTreeseedReconcileStatus({
						tenantRoot: context.cwd,
						target: targetFor(environment),
						env,
						selector,
					})
					: null;
				const graphReport = liveStatus
					? hostingReportWithReadOnlyStatus(serializeHostingPlan(plan), liveStatus)
					: serializeHostingPlan(plan);
				const report = reconcilePlan ? { ...graphReport, reconcile: serializeReconcilePlan(reconcilePlan) } : graphReport;
			const planFailures = invocation.args.placementOnly === true
				? []
				: reconcilePlan
					? reconcilePlanFailures(reconcilePlan)
					: report.ok === false || report.liveVerification?.ok === false
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
						lines: reconcilePlan
							? report.reconcile.plans.map((entry: any) => renderReconcilePlanLine(entry))
							: report.units.map((entry) => renderUnitLine(entry)),
					},
				],
				report: stripLegacyPlanningFields(liveHostedServices ? { ...report, hostedServices: liveHostedServices } : report),
				exitCode: planFailures.length > 0 || liveFailures.length > 0 ? 1 : 0,
				stderr: [...planFailures, ...liveFailures],
			});
		}

			const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
			const plan = await planTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, env, ...filterInput });
			const planReport = serializeHostingPlan(plan);
		const selector = selectorFromHostingGraph(graph);
		const reconcileResult = await reconcileTreeseedTarget({
					tenantRoot: context.cwd,
					target: targetFor(environment),
					env,
					selector,
					planOnly: false,
					write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
				});
		let status = await collectTreeseedReconcileStatus({
					tenantRoot: context.cwd,
					target: targetFor(environment),
					env,
					selector,
				});
		const selectedRailwayServiceNames = new Set(graph.units
			.filter((unit) => unit.host.id === 'railway')
			.map((unit) => typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null)
			.filter((value): value is string => Boolean(value)));
		const selectedRailwayServices = environment === 'local'
			? []
			: configuredRailwayServices(context.cwd, environment, env)
				.filter((service) => selectedRailwayServiceNames.has(service.serviceName));
		const deployments = selectedRailwayServices.length > 0
			? await waitForRailwayManagedDeploymentsSettled(context.cwd, environment, {
				services: selectedRailwayServices,
				env,
				timeoutMs: 600_000,
				onProgress: (line, stream) => context.write(`[railway] ${line}`, stream === 'stdout' ? 'stderr' : stream),
			})
			: null;
		if (deployments?.ok === false) {
			const failures = deployments.checks
				.filter((check) => check.ok !== true && check.skipped !== true)
				.map((check) => `${check.serviceName ?? check.service}: ${check.message ?? check.status ?? 'deployment did not settle'}`);
			throw new Error(`Railway deployments did not settle before live verification:\n${failures.join('\n')}`);
		}
		const report = {
			...planReport,
			selector,
			results: planReport.units.map((entry) => ({
				unit: entry.unit,
				plan: entry.plan,
				verification: entry.verification,
				reconcile: reconcileResult?.results.find((result) => result.unit.logicalName === entry.unit.id || result.unit.unitId.includes(entry.unit.id)) ?? null,
			})),
			reconcile: reconcileResult,
			deployments,
			status,
			ok: status ? status.ready : true,
		};
		const liveHostedServices = environment !== 'local'
				? await collectLiveChecks({
					tenantRoot: context.cwd,
					target: environment,
					appId,
					serviceKeys: filter.serviceIds,
					strict: true,
					requireLiveRailway: !appId || appId === 'api',
					requireLiveHttp: true,
					httpRetry: { attempts: 30, intervalMs: 5_000 },
					env,
				})
				: null;
		const liveFailures = liveHostedServices
			? [
				...liveHostedServices.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
				...liveHostedServices.liveObservation.issues,
			]
			: [];
			if (status?.ready === false && liveHostedServices && liveFailures.length === 0) {
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
			summary: `Applied hosting graph for ${environment}`,
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Application', value: appId ?? '(workspace)' },
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
			exitCode: liveFailures.length > 0 || finalReport.ok === false ? 1 : 0,
			stderr: liveFailures,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
