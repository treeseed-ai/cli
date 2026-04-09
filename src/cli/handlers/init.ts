import type { TreeseedCommandHandler } from '../types.js';
import { packageScriptPath } from '../../../scripts/package-tools.ts';
import { guidedResult } from './utils.js';

export const handleInit: TreeseedCommandHandler = (invocation, context) => {
	const directory = invocation.positionals[0];
	const result = context.spawn(process.execPath, [packageScriptPath('scaffold-site'), ...invocation.rawArgs], {
		cwd: context.cwd,
		env: { ...context.env },
		stdio: 'inherit',
	});
	if ((result.status ?? 1) !== 0) {
		return { exitCode: result.status ?? 1 };
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
		},
	});
};
