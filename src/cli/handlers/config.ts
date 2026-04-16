import {
	applyTreeseedSafeRepairs,
	collectTreeseedConfigContext,
	findNearestTreeseedRoot,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { fail, guidedResult } from './utils.js';
import { buildCliConfigPages, runCliConfigEditor } from './config-ui.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

function normalizeConfigScopes(value: unknown) {
	const requested = Array.isArray(value)
		? value.map(String)
		: typeof value === 'string'
			? [value]
			: ['all'];
	if (requested.includes('all')) {
		return ['local', 'staging', 'prod'] as Array<'local' | 'staging' | 'prod'>;
	}
	return ['local', 'staging', 'prod'].filter((scope) => requested.includes(scope)) as Array<'local' | 'staging' | 'prod'>;
}

function formatPrintEnvReports(payload: Record<string, any>) {
	const lines: string[] = [];
	for (const report of payload.reports ?? []) {
		lines.push(`Resolved environment values for ${report.scope}`);
		lines.push(payload.secretsRevealed ? 'Secrets are shown.' : 'Secret values are masked.');
		for (const entry of report.environment?.entries ?? []) {
			lines.push(`${entry.id}=${entry.displayValue} (${entry.source})`);
		}
		lines.push('');
		lines.push(`Provider connection checks for ${report.scope}`);
		for (const check of report.provider?.checks ?? []) {
			const status = check.ready ? 'ready' : check.skipped ? 'skipped' : 'failed';
			lines.push(`${check.provider}: ${status} - ${check.detail}`);
		}
		lines.push('');
	}
	return lines.filter((line, index, all) => !(line === '' && all[index - 1] === ''));
}

function renderConfigResult(commandName: string, result: any) {
	const payload = result.payload as Record<string, any>;
	const toolHealth = payload.toolHealth as Record<string, any> | undefined;
	const readinessByScope = payload.result?.readinessByScope ?? {};
	const summary = payload.mode === 'print-env-only'
		? 'Treeseed config environment report completed.'
		: payload.mode === 'rotate-machine-key'
			? 'Treeseed machine key rotated successfully.'
			: 'Treeseed config completed successfully.';
	return guidedResult({
		command: commandName,
		summary,
		facts: [
			{ label: 'Mode', value: payload.mode },
			{ label: 'Scopes', value: Array.isArray(payload.scopes) ? payload.scopes.join(', ') : '(none)' },
			{ label: 'Sync', value: payload.sync ?? 'all' },
			{ label: 'Safe repairs', value: Array.isArray(payload.repairs) ? payload.repairs.length : 0 },
			{ label: 'Machine config', value: payload.configPath },
			{ label: 'Machine key', value: payload.keyPath },
			{ label: 'Local readiness', value: readinessByScope.local?.deployable ? 'deployable' : readinessByScope.local?.configured ? 'configured' : 'pending' },
			{ label: 'Staging readiness', value: readinessByScope.staging?.deployable ? 'deployable' : readinessByScope.staging?.provisioned ? 'provisioned' : readinessByScope.staging?.configured ? 'configured' : 'pending' },
			{ label: 'Prod readiness', value: readinessByScope.prod?.deployable ? 'deployable' : readinessByScope.prod?.provisioned ? 'provisioned' : readinessByScope.prod?.configured ? 'configured' : 'pending' },
			{ label: 'GitHub CLI', value: toolHealth?.githubCli?.available ? 'ready' : 'missing' },
			{ label: 'gh act', value: toolHealth?.ghActExtension?.available ? 'ready' : 'missing' },
			{ label: 'Docker', value: toolHealth?.dockerDaemon?.available ? 'ready' : 'missing' },
			{ label: 'ACT verify', value: toolHealth?.actVerificationReady ? 'ready' : 'not ready' },
		],
		nextSteps: renderWorkflowNextSteps(result),
		report: payload,
	});
}

export const handleConfig: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const workflow = createWorkflowSdk(context, {
			write: context.outputFormat === 'json' ? (() => {}) : context.write,
		});
		const scopes = normalizeConfigScopes(invocation.args.environment);
		const sync = invocation.args.sync as never;
		const interactive = context.outputFormat !== 'json' && process.stdin.isTTY && process.stdout.isTTY;
		if (interactive && invocation.args.printEnvOnly !== true && invocation.args.rotateMachineKey !== true) {
			const tenantRoot = findNearestTreeseedRoot(context.cwd) ?? context.cwd;
			if (!tenantRoot) {
				return fail('Treeseed config requires a Treeseed project. Run the command from inside a tenant or initialize one first.');
			}
			applyTreeseedSafeRepairs(tenantRoot);
			const configContext = collectTreeseedConfigContext({
				tenantRoot,
				scopes,
				env: context.env,
			});
			const editorResult = await runCliConfigEditor(configContext, {
				initialViewMode: invocation.args.full === true ? 'full' : 'startup',
			});
			if (editorResult === null) {
				return fail('Treeseed config canceled.');
			}
			const updates = buildCliConfigPages(configContext, 'all', editorResult.overrides, 'full').map((page) => ({
				scope: page.scope,
				entryId: page.entry.id,
				value: page.finalValue,
				reused: !(page.key in editorResult.overrides),
			}));
			const result = await workflow.config({
				environment: scopes as never,
				sync,
				printEnv: invocation.args.printEnv === true,
				showSecrets: invocation.args.showSecrets === true,
				nonInteractive: true,
				updates,
			});
			return renderConfigResult(invocation.commandName || 'config', result);
		}

		const result = await workflow.config({
			environment: invocation.args.environment as never,
			sync,
			printEnv: invocation.args.printEnv === true,
			printEnvOnly: invocation.args.printEnvOnly === true,
			showSecrets: invocation.args.showSecrets === true,
			rotateMachineKey: invocation.args.rotateMachineKey === true,
			nonInteractive: context.outputFormat === 'json',
		});
		if (context.outputFormat !== 'json' && (result.payload as Record<string, any>).mode === 'print-env-only') {
			return {
				exitCode: 0,
				stdout: formatPrintEnvReports(result.payload as Record<string, any>),
				report: {
					command: invocation.commandName || 'config',
					ok: true,
					...(result.payload as Record<string, any>),
				},
			};
		}
		return renderConfigResult(invocation.commandName || 'config', result);
	} catch (error) {
		return workflowErrorResult(error);
	}
};
