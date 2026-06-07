import {
	collectTreeseedDeploymentReadiness,
	collectTreeseedLiveHostedServiceChecks,
	collectTreeseedHostedServiceChecks,
	formatTreeseedReadinessReport,
	runTreeseedMarketRunnerSmoke,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, workflowErrorResult } from './workflow.js';

function environmentFor(value: unknown): 'local' | 'staging' | 'prod' {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'staging';
	if (raw === 'prod' || raw === 'production') return 'prod';
	if (raw === 'local') return 'local';
	return 'staging';
}

function failedCount(section: { summary?: { failed?: number } } | null | undefined) {
	return Number(section?.summary?.failed ?? 0);
}

export const handleReady: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const environment = environmentFor(invocation.positionals[0] ?? invocation.args.environment);
		const live = invocation.args.live === true || environment !== 'local';
		const strict = invocation.args.strict === true || environment !== 'local';
		const status = await createWorkflowSdk(context).status();
		const readiness = collectTreeseedDeploymentReadiness({ tenantRoot: context.cwd, environment });
		const hostedServices = live
			? await collectTreeseedLiveHostedServiceChecks({
				tenantRoot: context.cwd,
				target: environment,
				strict,
				requireLiveRailway: strict,
				requireLiveHttp: strict,
				env: context.env,
			})
			: collectTreeseedHostedServiceChecks({ tenantRoot: context.cwd, target: environment });
		const runnerSmoke = live && environment !== 'local' && readiness.ok
			? await runTreeseedMarketRunnerSmoke({
				tenantRoot: context.cwd,
				environment,
				env: context.env,
			})
			: null;
		const ok = readiness.ok
			&& failedCount(hostedServices) === 0
			&& (runnerSmoke ? runnerSmoke.ok : true);
		const nextActions = [
			...readiness.checks
				.filter((check) => check.status === 'failed' && check.remediation)
				.map((check) => check.remediation!),
			...(runnerSmoke && !runnerSmoke.ok ? [
				`npx trsd operations smoke --environment ${environment} --service marketOperationsRunner --json`,
				`npx trsd hosting verify --environment ${environment} --service marketOperationsRunner --live --json`,
			] : []),
		];
		const report = {
			ok,
			environment,
			live,
			strict,
			workflow: status.payload,
			deploymentReadiness: readiness,
			hostedServices,
			runnerSmoke,
			nextActions,
		};
		return guidedResult({
			command: 'ready',
			summary: ok ? `Treeseed ${environment} readiness passed.` : `Treeseed ${environment} readiness failed.`,
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Live', value: live ? 'yes' : 'no' },
				{ label: 'Readiness failed', value: readiness.summary.failed },
				{ label: 'Hosted checks failed', value: hostedServices.summary.failed },
				{ label: 'Runner smoke', value: runnerSmoke ? runnerSmoke.ok ? 'passed' : 'failed' : 'skipped' },
			],
			sections: [
				{
					title: 'Deployment readiness',
					lines: formatTreeseedReadinessReport(readiness).split('\n'),
				},
			],
			nextSteps: nextActions,
			report,
			exitCode: ok ? 0 : 1,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
