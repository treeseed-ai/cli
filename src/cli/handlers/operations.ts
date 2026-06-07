import { runTreeseedMarketRunnerSmoke } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

function environmentFor(value: unknown): 'staging' | 'prod' {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'staging';
	return raw === 'prod' || raw === 'production' ? 'prod' : 'staging';
}

export const handleOperations: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const action = typeof invocation.positionals[0] === 'string' ? invocation.positionals[0] : 'smoke';
		if (action !== 'smoke') {
			throw new Error(`Unsupported operations action "${action}". Use smoke.`);
		}
		const service = typeof invocation.args.service === 'string' ? invocation.args.service : 'marketOperationsRunner';
		if (service !== 'marketOperationsRunner') {
			throw new Error(`Unsupported operations smoke service "${service}". Use marketOperationsRunner.`);
		}
		const environment = environmentFor(invocation.args.environment);
		const report = await runTreeseedMarketRunnerSmoke({
			tenantRoot: context.cwd,
			environment,
			env: context.env,
		});
		return guidedResult({
			command: 'operations smoke',
			summary: report.ok ? 'Market operations runner smoke passed.' : 'Market operations runner smoke failed.',
			facts: [
				{ label: 'Environment', value: environment },
				{ label: 'Base URL', value: report.baseUrl },
				{ label: 'Operation', value: report.operationId ?? '(none)' },
				{ label: 'Final status', value: report.finalStatus ?? '(none)' },
				{ label: 'Runner', value: report.runnerId ?? '(none)' },
			],
			nextSteps: report.ok ? [] : [
				`npx trsd hosting verify --environment ${environment} --service marketOperationsRunner --live --json`,
			],
			report,
			exitCode: report.ok ? 0 : 1,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
