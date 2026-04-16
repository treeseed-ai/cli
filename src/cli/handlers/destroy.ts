import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

async function promptForConfirmation(expected: string) {
	const rl = readline.createInterface({ input, output });
	try {
		return (await rl.question('Confirmation: ')).trim();
	} finally {
		rl.close();
	}
}

export const handleDestroy: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context, {
			confirm: async (_message, expected) => {
				if (typeof invocation.args.confirm === 'string') {
					return invocation.args.confirm === expected;
				}
				if (invocation.args.skipConfirmation === true || context.outputFormat === 'json' || !process.stdin.isTTY || !process.stdout.isTTY) {
					return false;
				}
				return (await promptForConfirmation(expected)) === expected;
			},
		}).destroy({
			environment: String(invocation.args.environment) as 'local' | 'staging' | 'prod',
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
			force: invocation.args.force === true,
			removeBuildArtifacts: invocation.args.removeBuildArtifacts === true,
		});
		const payload = result.payload as {
			scope: string;
			dryRun: boolean;
			removeBuildArtifacts: boolean;
		};
		return guidedResult({
			command: invocation.commandName || 'destroy',
			summary: result.executionMode === 'plan'
				? 'Treeseed destroy plan ready.'
				: 'Treeseed destroy completed successfully.',
			facts: [
				{ label: 'Environment', value: payload.scope },
				{ label: 'Dry run', value: payload.dryRun ? 'yes' : 'no' },
				{ label: 'Removed build artifacts', value: payload.removeBuildArtifacts ? 'yes' : 'no' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
