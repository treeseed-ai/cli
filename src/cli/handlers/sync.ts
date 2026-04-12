import type { TreeseedCommandHandler } from '../types.js';
import { TreeseedOperationsSdk } from '@treeseed/sdk/operations';

const operations = new TreeseedOperationsSdk();

export const handleSync: TreeseedCommandHandler = async (invocation, context) => {
	const result = await operations.execute({
		operationName: 'sync',
		input: {
			check: invocation.args.check === true,
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
