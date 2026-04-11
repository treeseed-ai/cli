import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleConfig: TreeseedCommandHandler = async (invocation, context) => {
	const rl = readline.createInterface({ input, output });
	try {
		const workflow = createWorkflowSdk(context, {
			write: context.outputFormat === 'json' ? (() => {}) : context.write,
			prompt: async (message) => {
				if (!process.stdin.isTTY || !process.stdout.isTTY) {
					return '';
				}
				return rl.question(message);
			},
		});
		const result = await workflow.config({
			environment: invocation.args.environment as never,
			sync: invocation.args.sync as never,
			printEnv: invocation.args.printEnv === true,
			printEnvOnly: invocation.args.printEnvOnly === true,
			showSecrets: invocation.args.showSecrets === true,
			rotateMachineKey: invocation.args.rotateMachineKey === true,
			nonInteractive: context.outputFormat === 'json',
		});
		const payload = result.payload as Record<string, any>;
		const toolHealth = payload.toolHealth as Record<string, any> | undefined;
		const summary = payload.mode === 'print-env-only'
			? 'Treeseed config environment report completed.'
			: payload.mode === 'rotate-machine-key'
				? 'Treeseed machine key rotated successfully.'
				: 'Treeseed config completed successfully.';
		return guidedResult({
			command: invocation.commandName || 'config',
			summary,
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Scopes', value: Array.isArray(payload.scopes) ? payload.scopes.join(', ') : '(none)' },
				{ label: 'Sync', value: payload.sync ?? 'all' },
				{ label: 'Safe repairs', value: Array.isArray(payload.repairs) ? payload.repairs.length : 0 },
				{ label: 'Machine config', value: payload.configPath },
				{ label: 'Machine key', value: payload.keyPath },
				{ label: 'GitHub CLI', value: toolHealth?.githubCli?.available ? 'ready' : 'missing' },
				{ label: 'gh act', value: toolHealth?.ghActExtension?.available ? 'ready' : 'missing' },
				{ label: 'Docker', value: toolHealth?.dockerDaemon?.available ? 'ready' : 'missing' },
				{ label: 'ACT verify', value: toolHealth?.actVerificationReady ? 'ready' : 'not ready' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: payload,
		});
	} catch (error) {
		return workflowErrorResult(error);
	} finally {
		rl.close();
	}
};
