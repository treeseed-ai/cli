import { commandIndex, commandSpecs, isCommandBranch } from './registry.js';

function usage(name: string) {
	const command = commandIndex.get(name)!;
	return ['trsd', name, ...command.arguments.map((argument) => argument.required ? `<${argument.name}>` : `[${argument.name}]`), command.options.length ? '[options]' : ''].filter(Boolean).join(' ');
}

export function renderHelp(path?: string | null) {
	if (!path) return ['TreeSeed CLI', '', 'Run `trsd` in a terminal for the integrated Follow, Chat, Inbox, and Explore interface.', '', 'Interactive deep links', '  trsd team                          Open Follow / Atlas (the Team workspace).', '  trsd chat                          Open the Chat workspace.', '  trsd inbox                         Open the Inbox workspace.', '  trsd discover                      Open the Explore workspace.', '  trsd ui --surface <surface>        Open any registered surface.', '  trsd ui --scene <scene>            Reopen a deterministic live-seed development scene.', '', 'Machine-oriented commands', ...commandSpecs.map((command) => `  ${command.name.padEnd(34)} ${command.description}`), '', 'Run `trsd help <command path>` for details.'].join('\n');
	const command = commandIndex.get(path);
	if (command) return [`trsd ${command.name}`, '', command.description, '', `Usage: ${usage(command.name)}`, '', ...command.arguments.map((argument) => `  ${argument.required ? `<${argument.name}>` : `[${argument.name}]`}  ${argument.description}`), ...command.options.map((option) => `  ${option.flag}${option.kind === 'string' ? ' <value>' : ''}  ${option.description}`)].join('\n');
	if (isCommandBranch(path)) return [`trsd ${path}`, '', ...commandSpecs.filter((entry) => entry.name.startsWith(`${path} `)).map((entry) => `  ${entry.name}  ${entry.description}`)].join('\n');
	return `Unknown trsd command: ${path}\nRun \`trsd help\` to see the accepted command tree.`;
}
