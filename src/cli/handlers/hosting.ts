import {
	applyTreeseedHostingGraph,
	compileTreeseedHostingGraph,
	planTreeseedHostingGraph,
	serializeHostingApplyResult,
	serializeHostingPlan,
	serializeHostingUnit,
	type TreeseedHostingEnvironment,
} from '@treeseed/sdk/hosting';
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
	if (!['plan', 'apply', 'verify', 'status'].includes(subcommand)) {
		throw new Error(`Unknown hosting subcommand "${subcommand}". Use plan, apply, verify, or status.`);
	}
	return subcommand as 'plan' | 'apply' | 'verify' | 'status';
}

function renderUnitLine(entry: { unit: ReturnType<typeof serializeHostingUnit>; plan?: { action?: string }; verification?: { verified?: boolean } }) {
	return `${entry.unit.id}: ${entry.unit.serviceType} -> ${entry.unit.hostId} (${entry.unit.placement})${entry.plan?.action ? ` ${entry.plan.action}` : ''}${entry.verification ? ` verified=${entry.verification.verified ? 'yes' : 'no'}` : ''}`;
}

export const handleHosting: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const subcommand = subcommandFor(invocation.positionals[0]);
		const environment = environmentFor(invocation.args.environment);
		const dryRun = invocation.args.dryRun !== false && invocation.args.execute !== true;

		if (subcommand === 'status') {
			const graph = compileTreeseedHostingGraph({ tenantRoot: context.cwd, environment });
			const units = graph.units.map((unit) => serializeHostingUnit(unit));
			return guidedResult({
				command: 'hosting status',
				summary: `Hosting graph status for ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
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
						placements: graph.placements,
						units,
						warnings: graph.warnings,
					},
				},
			});
		}

		if (subcommand === 'plan' || subcommand === 'verify') {
			const plan = await planTreeseedHostingGraph({ tenantRoot: context.cwd, environment, dryRun: true });
			const report = serializeHostingPlan(plan);
			return guidedResult({
				command: `hosting ${subcommand}`,
				summary: `${subcommand === 'verify' ? 'Verified' : 'Planned'} hosting graph for ${environment}`,
				facts: [
					{ label: 'Environment', value: environment },
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
				report,
			});
		}

		const result = await applyTreeseedHostingGraph({ tenantRoot: context.cwd, environment, dryRun });
		const report = serializeHostingApplyResult(result);
		return guidedResult({
			command: 'hosting apply',
			summary: `${dryRun ? 'Dry-run applied' : 'Applied'} hosting graph for ${environment}`,
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Dry run', value: dryRun ? 'yes' : 'no' },
				{ label: 'Units', value: String(report.results.length) },
				{ label: 'Verified units', value: String(report.results.filter((entry) => entry.verification.verified).length) },
			],
			sections: [
				{
					title: 'Results',
					lines: report.results.map((entry) => renderUnitLine({
						unit: entry.unit,
						plan: entry.plan,
						verification: entry.verification,
					})),
				},
			],
			report,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};

