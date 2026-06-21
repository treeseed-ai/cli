import { runTreeseedOperationsRunnerSmoke } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

function environmentFor(value: unknown): 'local' | 'staging' | 'prod' {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'staging';
	if (raw === 'local') return 'local';
	return raw === 'prod' || raw === 'production' ? 'prod' : 'staging';
}

function failureNextSteps(environment: 'local' | 'staging' | 'prod') {
	if (environment === 'local') {
		return [
			'npx trsd dev start --web-runtime local --json',
			'npx trsd dev status --json',
		];
	}
	return [
		`npx trsd hosting verify --environment ${environment} --service operationsRunner --live --json`,
	];
}

export const handleOperations: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const action = typeof invocation.positionals[0] === 'string' ? invocation.positionals[0] : 'smoke';
		if (action !== 'smoke') {
			throw new Error(`Unsupported operations action "${action}". Use smoke.`);
		}
		const service = typeof invocation.args.service === 'string' ? invocation.args.service : 'operationsRunner';
		if (service !== 'operationsRunner') {
			throw new Error(`Unsupported operations smoke service "${service}". Use operationsRunner.`);
		}
		const environment = environmentFor(invocation.args.environment);
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: context.cwd,
			environment,
			env: context.env,
		});
		return guidedResult({
			command: 'operations smoke',
			summary: report.ok ? 'Treeseed operations runner smoke passed.' : 'Treeseed operations runner smoke failed.',
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Base URL', value: report.baseUrl },
				{ label: 'Operation', value: report.operationId ?? '(none)' },
				{ label: 'Final status', value: report.finalStatus ?? '(none)' },
				{ label: 'Runner', value: report.runnerId ?? '(none)' },
			],
			nextSteps: report.ok ? [] : [
				...failureNextSteps(environment),
			],
			report,
			exitCode: report.ok ? 0 : 1,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
