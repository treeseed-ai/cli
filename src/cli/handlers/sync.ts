import type { TreeseedCommandHandler } from '../types.js';
import { packageScriptPath } from '../../../scripts/package-tools.ts';

export const handleSync: TreeseedCommandHandler = (invocation, context) => {
	const result = context.spawn(process.execPath, [packageScriptPath('sync-template'), ...invocation.rawArgs], {
		cwd: context.cwd,
		env: { ...context.env },
		stdio: 'inherit',
	});
	return { exitCode: result.status ?? 1 };
};
