import {
	applyTreeseedHostingGraph,
	compileTreeseedHostingGraph,
	planTreeseedHostingGraph,
	serializeHostingApplyResult,
	serializeHostingPlan,
	serializeHostingUnit,
	type TreeseedHostingEnvironment,
} from '@treeseed/sdk/hosting';
import {
	collectTreeseedConfigSeedValues,
	collectTreeseedLiveHostedServiceChecks as collectLiveChecks,
	deleteRailwayProject,
	listRailwayProjects,
	resolveRailwayWorkspaceContext,
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

export const handleHosting: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const subcommand = subcommandFor(invocation.positionals[0]);
		const environment = environmentFor(invocation.args.environment);
		const dryRun = invocation.args.dryRun !== false && invocation.args.execute !== true;
		const appId = typeof invocation.args.app === 'string' && invocation.args.app.trim()
			? invocation.args.app.trim()
			: undefined;
		const filter = {
			serviceIds: listArg(invocation.args.service),
			placements: listArg(invocation.args.placement) as any,
			hosts: listArg(invocation.args.host),
		};
		const filterInput = filter.serviceIds.length || filter.placements.length || filter.hosts.length
			? { filter }
			: {};

		if (subcommand === 'status') {
			const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, ...filterInput });
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
			const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, ...filterInput });
			const selectedProjectNames = graph.units
				.filter((unit) => unit.host.id === 'railway')
				.map((unit) => unit.projectGroup?.environments?.[environment]?.projectName)
				.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
			const railwayProjectNames = [...new Set(selectedProjectNames)];
			const seedEnv = {
				...context.env,
				...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
			};
			const projects = railwayProjectNames.length === 0
				? []
				: await listRailwayProjects({
					workspaceId: (await resolveRailwayWorkspaceContext({ env: seedEnv })).id,
					env: seedEnv,
				});
			const results = [];
			for (const projectName of railwayProjectNames) {
				const matchingProjects = projects.filter((entry) => entry.name === projectName || entry.id === projectName);
				if (matchingProjects.length === 0) {
					results.push({
						projectName,
						projectId: null,
						action: dryRun ? 'destroy' : 'noop',
						result: { status: dryRun ? 'planned' : 'missing', projectName },
					});
					continue;
				}
				for (const project of matchingProjects) {
					const result = dryRun
						? { status: 'planned', projectName, projectId: project.id }
						: await deleteRailwayProject({ projectId: project.id, env: seedEnv });
					results.push({
						projectName,
						projectId: project.id,
						action: dryRun ? 'destroy' : result.status === 'missing' ? 'noop' : 'destroy',
						result,
					});
				}
			}
			return guidedResult({
				command: 'hosting destroy',
				summary: `${dryRun ? 'Planned' : 'Destroyed'} hosting resources for ${appId} in ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
					{ label: 'Application', value: appId },
					{ label: 'Dry run', value: dryRun ? 'yes' : 'no' },
					{ label: 'Railway projects', value: railwayProjectNames.length ? railwayProjectNames.join(', ') : '(none)' },
				],
				sections: [
					{
						title: 'Railway Projects',
						lines: results.length
							? results.map((entry) => `${entry.projectName}: ${entry.action}`)
							: ['No Railway project groups selected.'],
					},
				],
				report: {
					command: 'hosting destroy',
					environment,
					appId,
					dryRun,
					projects: results,
				},
			});
		}

		if (subcommand === 'plan' || subcommand === 'verify') {
			const plan = await planTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, dryRun: true, ...filterInput });
			const report = serializeHostingPlan(plan);
			const liveHostedServices = subcommand === 'verify' && invocation.args.live === true && environment !== 'local'
				? await collectLiveChecks({
					tenantRoot: context.cwd,
					target: environment,
					appId,
					strict: true,
					requireLiveRailway: !appId || appId === 'api',
					requireLiveHttp: true,
					env: {
						...context.env,
						...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
					},
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
				exitCode: liveFailures.length > 0 ? 1 : 0,
				stderr: liveFailures,
			});
		}

		const result = await applyTreeseedHostingGraph({ tenantRoot: context.cwd, environment, appId, dryRun, ...filterInput });
		const report = serializeHostingApplyResult(result);
		const liveHostedServices = !dryRun && environment !== 'local'
			? await collectLiveChecks({
				tenantRoot: context.cwd,
				target: environment,
				appId,
				strict: true,
				requireLiveRailway: !appId || appId === 'api',
				requireLiveHttp: true,
				env: {
					...context.env,
					...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
				},
			})
			: null;
		const liveFailures = liveHostedServices
			? [
				...liveHostedServices.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
				...liveHostedServices.liveObservation.issues,
			]
			: [];
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
