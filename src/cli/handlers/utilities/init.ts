import type { CommandHandler } from '../../types.js';
import { DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import { OperationsSdk } from '@treeseed/sdk/operations';
import { guidedResult } from './utils.js';

const operations = new OperationsSdk();

function normalizeRepeatable(value: unknown) {
	return Array.isArray(value)
		? value.map(String)
		: typeof value === 'string'
			? [value]
			: [];
}

export const handleInit: CommandHandler = async (invocation, context) => {
	const directory = invocation.positionals[0];
	const result = await operations.execute({
		operationName: 'init',
		input: {
			directory,
			template: invocation.args.template,
			name: invocation.args.name,
			slug: invocation.args.slug,
			siteUrl: invocation.args.siteUrl,
			contactEmail: invocation.args.contactEmail,
			repo: invocation.args.repo,
			discord: invocation.args.discord,
			hostBindingSpecs: normalizeRepeatable(invocation.args.host),
		},
	}, {
		cwd: context.cwd,
		env: context.env,
		write: context.write,
		spawn: context.spawn,
		outputFormat: context.outputFormat,
		transport: 'cli',
	});
	if (!result.ok) {
		return {
			exitCode: result.exitCode ?? 1,
			stdout: result.stdout,
			stderr: result.stderr,
			report: result.payload as Record<string, unknown> | null,
		};
	}
	const payload = result.payload as Record<string, any> | null;
	const hostSummaries = Array.isArray(payload?.hostBindingSummaries) ? payload.hostBindingSummaries as Array<Record<string, any>> : [];
	const configWrites = Array.isArray(payload?.hostBindingConfig?.configWrites) ? payload.hostBindingConfig.configWrites as Array<Record<string, any>> : [];
	const environmentWrites = Array.isArray(payload?.hostBindingConfig?.environmentWrites) ? payload.hostBindingConfig.environmentWrites as Array<Record<string, any>> : [];
	return guidedResult({
		command: 'init',
		summary: 'Treeseed init completed successfully.',
		facts: [
			{ label: 'Directory', value: directory ?? '(current directory)' },
			{ label: 'Template', value: String(payload?.template ?? DEFAULT_STARTER_TEMPLATE_ID) },
			{ label: 'Host bindings', value: hostSummaries.length > 0 ? hostSummaries.length : '(none)' },
		],
		sections: [
			...(hostSummaries.length > 0 ? [{
				title: 'Host Bindings',
				lines: hostSummaries.map((summary) =>
					`${summary.requirementKey}: ${summary.mode}${summary.provider ? ` ${summary.provider}` : ''}${summary.alias ? ` (${summary.alias})` : ''}`),
			}] : []),
			...(configWrites.length > 0 ? [{
				title: 'Config Writes',
				lines: configWrites.map((write) => `${write.target} ${write.path} <- ${write.provider ?? 'template'}`),
			}] : []),
			...(environmentWrites.length > 0 ? [{
				title: 'Environment Entries',
				lines: environmentWrites.map((entry) =>
					`${entry.env}: ${entry.sensitivity} from ${entry.requirementKey}${entry.sourceProvider ? ` (${entry.sourceProvider})` : ''}`),
			}] : []),
		],
		nextSteps: [
			`cd ${directory}`,
			`treeseed template show ${String(payload?.template ?? DEFAULT_STARTER_TEMPLATE_ID)}`,
			'treeseed sync --check',
			'treeseed doctor',
			'treeseed config --environment local',
			'treeseed dev',
		],
		report: {
			directory: directory ?? null,
			template: payload?.template ?? null,
			hostBindings: payload?.hostBindings ?? {},
			hostBindingPlans: payload?.hostBindingPlans ?? null,
			hostBindingSummaries: hostSummaries,
			hostBindingConfig: payload?.hostBindingConfig ?? null,
		},
	});
};
