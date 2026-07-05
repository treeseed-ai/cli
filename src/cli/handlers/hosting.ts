import {
	compileTreeseedHostingGraph,
	planTreeseedHostingGraph,
	serializeHostingPlan,
	serializeHostingUnit,
	type TreeseedHostingEnvironment,
} from '@treeseed/sdk/hosting';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

function readPackageVersion(packageJsonPath: string) {
	if (!existsSync(packageJsonPath)) return null;
	try {
		const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
		return typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : null;
	} catch {
		return null;
	}
}

function readTreeDxVersion(root: string) {
	const tsSdkVersion = readPackageVersion(resolve(root, 'packages/treedx/packages/ts-sdk/package.json'));
	if (tsSdkVersion) return tsSdkVersion;
	const pyprojectPath = resolve(root, 'packages/treedx/packages/python-sdk/pyproject.toml');
	if (!existsSync(pyprojectPath)) return null;
	const match = readFileSync(pyprojectPath, 'utf8').match(/^version\s*=\s*"([^"]+)"/mu);
	return match?.[1] ?? null;
}

function productionImageRefDefaults(root: string, environment: TreeseedHostingEnvironment) {
	if (environment !== 'prod') return {};
	const apiVersion = readPackageVersion(resolve(root, 'packages/api/package.json'));
	const agentVersion = readPackageVersion(resolve(root, 'packages/agent/package.json'));
	const treedxVersion = readTreeDxVersion(root);
	return {
		...(apiVersion ? {
			TREESEED_API_IMAGE_REF: `treeseed/api:${apiVersion}`,
			TREESEED_OPERATIONS_RUNNER_IMAGE_REF: `treeseed/op-runner:${apiVersion}`,
		} : {}),
		...(agentVersion ? {
			TREESEED_AGENT_MANAGER_IMAGE_REF: `treeseed/agent-manager:${agentVersion}`,
			TREESEED_AGENT_RUNNER_IMAGE_REF: `treeseed/agent-runner:${agentVersion}`,
		} : {}),
		...(treedxVersion ? {
			TREESEED_PUBLIC_TREEDX_IMAGE_REF: `treeseed/treedx:${treedxVersion}`,
		} : {}),
	};
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
			if (unit.id.startsWith('public-treedx-node-') || unit.serviceType.id === 'treedx-node') return ['api-runtime', 'railway-service:api'];
			if (unit.placement === 'runner-capacity') return ['api-runtime', 'operations-runner-runtime', 'railway-service:api', 'railway-service:operations-runner'];
			if (unit.host.id === 'cloudflare') return ['web-ui', 'edge-worker', 'content-store', 'queue', 'database', 'kv-form-guard', 'turnstile-widget', 'pages-project', 'custom-domain:web', 'dns-record'];
			return [];
		}))],
	};
}

function reconcileResultMatchesHostingUnit(result: any, unit: any) {
	const serviceKey = typeof result?.unit?.metadata?.serviceKey === 'string' ? result.unit.metadata.serviceKey : null;
	const logicalName = typeof result?.unit?.logicalName === 'string' ? result.unit.logicalName : null;
	const unitId = typeof result?.unit?.unitId === 'string' ? result.unit.unitId : null;
	const serviceName = typeof unit?.config?.serviceName === 'string' ? unit.config.serviceName : null;
	return Boolean(
		serviceKey === unit.id
		|| logicalName === unit.id
		|| logicalName === serviceName
		|| unitId === unit.id
		|| (typeof unitId === 'string' && (unitId.endsWith(`:${unit.id}`) || (serviceName && unitId.endsWith(`:${serviceName}`))))
	);
}

function preferConcreteReconcileResult(left: any, right: any) {
	if (!left) return right;
	const leftProvider = typeof left?.unit?.provider === 'string' ? left.unit.provider : '';
	const rightProvider = typeof right?.unit?.provider === 'string' ? right.unit.provider : '';
	if (leftProvider === 'treeseed' && rightProvider !== 'treeseed') return right;
	return left;
}

function hostingReportWithLiveReconcile(report: any, reconcileResult: any) {
	const results = Array.isArray(reconcileResult?.results) ? reconcileResult.results : [];
	const units = Array.isArray(report?.units)
		? report.units.map((entry: any) => {
			const matched = results
				.filter((result: any) => reconcileResultMatchesHostingUnit(result, entry.unit))
				.reduce((selected: any, result: any) => preferConcreteReconcileResult(selected, result), null);
			if (!matched?.verification) return entry;
			return {
				...entry,
				observed: {
					status: matched.verification.verified ? 'ready' : 'blocked',
					locators: matched.resourceLocators ?? {},
					state: matched.state ?? matched.observed?.live ?? {},
					warnings: matched.warnings ?? [],
				},
				plan: {
					...entry.plan,
					action: matched.verification.verified === true ? 'noop' : matched.diff?.action ?? entry.plan?.action ?? 'verify',
					reasons: matched.verification.verified === true
						? ['live provider state verified']
						: matched.diff?.reasons ?? entry.plan?.reasons ?? [],
					before: matched.observed?.live ?? entry.plan?.before ?? {},
				},
				verification: {
					unitId: entry.unit.id,
					status: matched.verification.verified ? 'ready' : 'blocked',
					verified: matched.verification.verified === true,
					checks: matched.verification.checks.map((check: any) => ({
						key: check.key,
						label: check.description,
						ok: check.verified === true,
						expected: check.expected,
						observed: check.observed,
						issues: check.issues ?? [],
					})),
					warnings: matched.verification.warnings ?? [],
				},
				reconcile: matched,
			};
		})
		: [];
	const liveIssues = units
		.filter((entry: any) => entry.verification?.verified !== true)
		.map((entry: any) => `${entry.unit.id}: live reconcile verification did not pass`);
	return {
		...report,
		units,
		reconcile: reconcileResult,
		liveVerification: {
			ok: liveIssues.length === 0,
			source: 'live-reconcile',
			issues: liveIssues,
		},
		ok: liveIssues.length === 0,
	};
}

function selectedSeedEnv(context: Parameters<TreeseedCommandHandler>[1], environment: TreeseedHostingEnvironment) {
	return {
		...productionImageRefDefaults(context.cwd, environment),
		...context.env,
		...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
	};
}

function stripLegacyPlanningFields(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => stripLegacyPlanningFields(entry));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>)
			.filter(([key]) => key !== 'planOnly')
			.map(([key, entry]) => [key, stripLegacyPlanningFields(entry)]));
	}
	return value;
}

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
				const liveReconcile = subcommand === 'verify' && invocation.args.live === true && environment !== 'local'
					? await reconcileTreeseedTarget({
						tenantRoot: context.cwd,
						target: targetFor(environment),
						env,
						selector: selectorFromHostingGraph(graph),
						planOnly: false,
						write: (line) => context.write(`[reconcile] ${line}`, 'stderr'),
					})
					: null;
				const report = liveReconcile
					? hostingReportWithLiveReconcile(serializeHostingPlan(plan), liveReconcile)
					: serializeHostingPlan(plan);
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
