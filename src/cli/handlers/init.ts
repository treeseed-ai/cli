import type { TreeseedCommandHandler } from '../types.js';
import { TreeseedOperationsSdk } from '@treeseed/sdk/operations';
import { guidedResult } from './utils.js';

const operations = new TreeseedOperationsSdk();

export const handleInit: TreeseedCommandHandler = async (invocation, context) => {
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
	return guidedResult({
		command: 'init',
		summary: 'Treeseed init completed successfully.',
		facts: [{ label: 'Directory', value: directory ?? '(current directory)' }],
		nextSteps: [
			`cd ${directory}`,
			'treeseed template show starter-basic',
			'treeseed sync --check',
			'treeseed doctor',
			'treeseed config --environment local',
			'treeseed dev',
		],
		report: {
			directory: directory ?? null,
			template: (result.payload as Record<string, unknown> | null)?.template ?? null,
		},
	});
};
