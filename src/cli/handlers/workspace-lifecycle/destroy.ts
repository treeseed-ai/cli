import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { CommandHandler } from '../../types.js';
import { guidedResult } from '../utilities/utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';

async function promptForConfirmation(expected: string) {
	const rl = readline.createInterface({ input, output });
	try {
		return (await rl.question('Confirmation: ')).trim();
	} finally {
		rl.close();
	}
}

export const handleDestroy: CommandHandler = async (invocation, context) => {
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
			plan: invocation.args.plan === true,
			force: invocation.args.force === true,
			deleteData: invocation.args.deleteData === true,
			sweep: invocation.args.sweep === true,
			removeBuildArtifacts: invocation.args.removeBuildArtifacts === true,
		});
		const payload = result.payload as {
			scope: string;
			deleteData?: boolean;
			sweep?: boolean;
			removeBuildArtifacts: boolean;
			remoteResult?: {
				verification?: {
					cloudflare?: { totalRemaining?: number; status?: string };
					localDocker?: { totalRemaining?: number; status?: string };
				} | null;
			} | null;
		};
		const verification = payload.remoteResult?.verification ?? null;
		return guidedResult({
			command: invocation.commandName || 'destroy',
			summary: result.executionMode === 'plan'
				? 'Treeseed destroy plan ready.'
				: 'Treeseed destroy completed successfully.',
			facts: [
				{ label: 'Environment', value: payload.scope },
				{ label: 'Delete data', value: payload.deleteData ? 'yes' : 'no' },
				{ label: 'Sweep TreeSeed resources', value: payload.sweep ? 'yes' : 'no' },
				{ label: 'Removed build artifacts', value: payload.removeBuildArtifacts ? 'yes' : 'no' },
				...(verification?.cloudflare
					? [{ label: 'Cloudflare remaining', value: String(verification.cloudflare.totalRemaining ?? 0) }]
					: []),
				...(verification?.localDocker
					? [{ label: 'Local Docker remaining', value: String(verification.localDocker.totalRemaining ?? 0) }]
					: []),
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
