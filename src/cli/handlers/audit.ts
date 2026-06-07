import {
	collectTreeseedHostedServiceChecks,
	formatTreeseedHostingAuditReport,
	runTreeseedHostingAudit,
	type TreeseedHostingAuditEnvironment,
	type TreeseedHostingAuditHostKind,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

const ENVIRONMENTS = new Set(['current', 'local', 'staging', 'prod']);
const HOST_KINDS = new Set(['repository', 'web', 'processing', 'email']);

function normalizeEnvironment(value: unknown): TreeseedHostingAuditEnvironment {
	const environment = typeof value === 'string' && value.trim() ? value.trim() : 'current';
	if (!ENVIRONMENTS.has(environment)) {
		throw new Error(`Unsupported audit environment "${environment}". Expected current, local, staging, or prod.`);
	}
	return environment as TreeseedHostingAuditEnvironment;
}

function normalizeHostKinds(value: unknown): TreeseedHostingAuditHostKind[] | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	const raw = Array.isArray(value)
		? value.flatMap((entry) => String(entry).split(','))
		: String(value).split(',');
	const hostKinds = raw
		.map((entry) => entry.trim())
		.filter(Boolean);
	const invalid = hostKinds.find((entry) => !HOST_KINDS.has(entry));
	if (invalid) {
		throw new Error(`Unsupported hosting audit host kind "${invalid}". Expected repository, web, processing, or email.`);
	}
	return [...new Set(hostKinds)] as TreeseedHostingAuditHostKind[];
}

function statusCounts(checks: Array<{ status: string }>) {
	return checks.reduce((counts, check) => {
		counts[check.status] = (counts[check.status] ?? 0) + 1;
		return counts;
	}, {} as Record<string, number>);
}

export const handleAudit: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const target = invocation.positionals[0] ?? 'hosting';
		if (target !== 'hosting') {
			throw new Error(`Unsupported audit target "${target}". The available target is "hosting".`);
		}
		const report = await runTreeseedHostingAudit({
			tenantRoot: context.cwd,
			environment: normalizeEnvironment(invocation.args.environment),
			repair: invocation.args.repair === true,
			env: context.env,
			hostKinds: normalizeHostKinds(invocation.args.hostKinds ?? invocation.args.hosts),
			write: context.write,
		});
		const hostedServices = collectTreeseedHostedServiceChecks({
			tenantRoot: context.cwd,
			target: report.environment === 'prod' ? 'prod' : report.environment === 'local' ? 'local' : 'staging',
		});
		const counts = statusCounts(report.checks);
		if (context.outputFormat === 'json') {
			return {
				exitCode: report.ok ? 0 : 1,
				stdout: [],
				report: {
					...report,
					hostedServices,
				},
			};
		}
		return guidedResult({
			command: 'audit',
			summary: formatTreeseedHostingAuditReport(report),
			facts: [
				{ label: 'Environment', value: report.environment },
				{ label: 'Target', value: report.target.label },
				{ label: 'Mode', value: report.repairMode ? 'repair' : 'read-only' },
				{ label: 'Passed', value: counts.passed ?? 0 },
				{ label: 'Warnings', value: (counts.warning ?? 0) + report.warnings.length },
				{ label: 'Failed', value: counts.failed ?? 0 },
				{ label: 'Hosted checks', value: `${hostedServices.summary.passed} passed, ${hostedServices.summary.warning} warnings, ${hostedServices.summary.failed} failed, ${hostedServices.summary.skipped} skipped` },
			],
			sections: [
				{
					title: 'Hosted service checks',
					lines: hostedServices.checks.map((check) =>
						`${check.provider} ${check.serviceKey ?? check.serviceType} ${check.description}: ${check.status}${check.issues.length ? ` (${check.issues.join('; ')})` : ''}`),
				},
			],
			nextSteps: report.nextActions,
			report: {
				...report,
				hostedServices,
			},
			exitCode: report.ok ? 0 : 1,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
