import type { TreeseedCommandHandler } from '../types.js';
import { TreeseedOperationsSdk } from '@treeseed/sdk/operations';

const operations = new TreeseedOperationsSdk();

export const handleTemplate: TreeseedCommandHandler = async (invocation, context) => {
	const result = await operations.execute({
		operationName: 'template',
		input: {
			action: invocation.positionals[0],
			id: invocation.positionals[1],
		},
	}, {
		cwd: context.cwd,
		env: context.env,
		write: context.write,
		spawn: context.spawn,
		outputFormat: context.outputFormat,
		transport: 'cli',
	});
	return {
		exitCode: result.exitCode ?? (result.ok ? 0 : 1),
		stdout: result.stdout,
		stderr: result.stderr,
		report: result.payload as Record<string, unknown> | null,
	};
};
