import {
	compileTreeseedHostingGraph,
	serializeHostingUnit,
	type TreeseedHostingEnvironment,
} from '@treeseed/sdk/hosting';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TreeseedReconcileSelector, TreeseedReconcileTarget } from '@treeseed/sdk/reconcile';
import { collectTreeseedConfigSeedValues } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';

export function environmentFor(value: unknown): TreeseedHostingEnvironment {
	return value === 'prod' || value === 'production'
		? 'prod'
		: value === 'staging'
			? 'staging'
			: 'local';
}

export function subcommandFor(value: unknown) {
	const subcommand = typeof value === 'string' && value.trim() ? value.trim() : 'status';
	if (!['plan', 'apply', 'verify', 'status', 'destroy'].includes(subcommand)) {
		throw new Error(`Unknown hosting subcommand "${subcommand}". Use plan, apply, verify, status, or destroy.`);
	}
	return subcommand as 'plan' | 'apply' | 'verify' | 'status' | 'destroy';
}

export function listArg(value: unknown) {
	const raw = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
	return [...new Set(raw.flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean))];
}

export function renderUnitLine(entry: { unit: ReturnType<typeof serializeHostingUnit>; plan?: { action?: string }; verification?: { verified?: boolean } }) {
	return `${entry.unit.id}: ${entry.unit.serviceType} -> ${entry.unit.hostId} (${entry.unit.placement})${entry.plan?.action ? ` ${entry.plan.action}` : ''}${entry.verification ? ` verified=${entry.verification.verified ? 'yes' : 'no'}` : ''}`;
}

export function renderReconcilePlanLine(entry: any) {
	const name = entry.unit?.logicalName ?? entry.unit?.unitId ?? 'unknown';
	const action = entry.diff?.action ?? 'unknown';
	const reasons = Array.isArray(entry.diff?.reasons) ? entry.diff.reasons.filter(Boolean) : [];
	return `${name}: ${action}${reasons.length > 0 ? ` (${reasons.join('; ')})` : ''}`;
}

export function targetFor(environment: TreeseedHostingEnvironment): TreeseedReconcileTarget {
	return { kind: 'persistent', scope: environment };
}

export function readPackageVersion(packageJsonPath: string) {
	if (!existsSync(packageJsonPath)) return null;
	try {
		const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
		return typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : null;
	} catch {
		return null;
	}
}

export function readTreeDxVersion(root: string) {
	const tsSdkVersion = readPackageVersion(resolve(root, 'packages/treedx/packages/ts-sdk/package.json'));
	if (tsSdkVersion) return tsSdkVersion;
	const pyprojectPath = resolve(root, 'packages/treedx/packages/python-sdk/pyproject.toml');
	if (!existsSync(pyprojectPath)) return null;
	const match = readFileSync(pyprojectPath, 'utf8').match(/^version\s*=\s*"([^"]+)"/mu);
	return match?.[1] ?? null;
}

export function productionImageRefDefaults(root: string, environment: TreeseedHostingEnvironment) {
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

export function selectorFromHostingGraph(graph: ReturnType<typeof compileTreeseedHostingGraph>): TreeseedReconcileSelector {
	const includesApi = graph.units.some((unit) => unit.id === 'api' || unit.config.serviceName === 'treeseed-api');
	const exactServiceIds = [...new Set(graph.units.flatMap((unit) => [
		unit.id,
		typeof unit.config.poolKey === 'string' ? unit.config.poolKey : null,
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
			if (unit.id === 'operationsRunner' || unit.config.poolKey === 'operationsRunner') return ['operations-runner-runtime', 'railway-service:operations-runner'];
			if (unit.id.startsWith('public-treedx-node-') || unit.serviceType.id === 'treedx-node') return ['api-runtime', 'railway-service:api'];
			if (unit.placement === 'runner-capacity') return ['api-runtime', 'operations-runner-runtime', 'railway-service:api', 'railway-service:operations-runner'];
			if (unit.host.id === 'cloudflare') return ['web-ui', 'edge-worker', 'content-store', 'queue', 'database', 'kv-form-guard', 'turnstile-widget', 'pages-project', 'custom-domain:web', 'dns-record'];
			return [];
		}))],
	};
}

export function hostingReportWithReadOnlyStatus(report: any, status: any) {
	const statuses = Array.isArray(status?.units) ? status.units : [];
	const units = Array.isArray(report?.units)
		? report.units.map((entry: any) => {
			const serviceName = typeof entry.unit?.config?.serviceName === 'string' ? entry.unit.config.serviceName : null;
			const matched = statuses.find((candidate: any) =>
				candidate.unitId === entry.unit.id
				|| String(candidate.unitId ?? '').endsWith(`:${entry.unit.id}`)
				|| (serviceName && String(candidate.unitId ?? '').endsWith(`:${serviceName}`)));
			if (!matched?.verification) return entry;
			return {
				...entry,
				observed: {
					status: matched.verification.verified ? 'ready' : 'blocked',
					locators: matched.locators ?? {},
					warnings: matched.warnings ?? [],
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
			};
		})
		: [];
	return {
		...report,
		units,
		reconcileStatus: status,
		liveVerification: {
			ok: status?.ready === true,
			source: 'read-only-reconcile-status',
			issues: status?.blockers ?? [],
		},
		ok: status?.ready === true,
	};
}

export function selectedSeedEnv(context: Parameters<TreeseedCommandHandler>[1], environment: TreeseedHostingEnvironment) {
	return {
		...productionImageRefDefaults(context.cwd, environment),
		...context.env,
		...collectTreeseedConfigSeedValues(context.cwd, environment, context.env),
	};
}

export function stripLegacyPlanningFields(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => stripLegacyPlanningFields(entry));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>)
			.filter(([key]) => key !== 'planOnly')
			.map(([key, entry]) => [key, stripLegacyPlanningFields(entry)]));
	}
	return value;
}

export function serializeReconcilePlan(result: any) {
	return {
		target: result?.target ?? null,
		plans: Array.isArray(result?.plans) ? result.plans.map((entry: any) => ({
			unit: {
				unitId: entry.unit?.unitId ?? null,
				provider: entry.unit?.provider ?? null,
				unitType: entry.unit?.unitType ?? null,
				logicalName: entry.unit?.logicalName ?? null,
			},
			observed: {
				exists: entry.observed?.exists === true,
				status: entry.observed?.status ?? null,
				locators: entry.observed?.locators ?? {},
				warnings: entry.observed?.warnings ?? [],
			},
			diff: entry.diff ?? null,
		})) : [],
		results: Array.isArray(result?.results) ? result.results.map((entry: any) => ({
			unitId: entry.unit?.unitId ?? null,
			action: entry.action ?? null,
			warnings: entry.warnings ?? [],
		})) : [],
		timings: result?.timings ?? [],
	};
}

export function reconcilePlanFailures(result: any) {
	const plans = Array.isArray(result?.plans) ? result.plans : [];
	return plans
		.filter((entry: any) => entry?.diff?.action === 'blocked')
		.map((entry: any) => {
			const name = entry.unit?.logicalName ?? entry.unit?.unitId ?? 'unknown';
			const reasons = Array.isArray(entry.diff?.reasons) ? entry.diff.reasons.filter(Boolean) : [];
			return `${name}: ${reasons.join('; ') || 'reconciliation plan is blocked'}`;
		});
}
