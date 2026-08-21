import { commandIndex, commandSpecs, isCommandBranch } from './registry.js';

function usage(name: string) {
	const command = commandIndex.get(name)!;
	return ['trsd', name, ...command.arguments.map((argument) => `<${argument.name}>`), command.options.length ? '[options]' : ''].filter(Boolean).join(' ');
}

export function renderHelp(path?: string | null) {
	if (!path) return ['TreeSeed CLI', '', 'A human-centered client for the authoritative TreeSeed control-plane API.', '', ...commandSpecs.map((command) => `  ${command.name.padEnd(34)} ${command.description}`), '', 'Run `trsd help <command path>` for details.'].join('\n');
	const command = commandIndex.get(path);
	if (command) return [`trsd ${command.name}`, '', command.description, '', `Usage: ${usage(command.name)}`, '', ...command.arguments.map((argument) => `  <${argument.name}>  ${argument.description}`), ...command.options.map((option) => `  ${option.flag}${option.kind === 'string' ? ' <value>' : ''}  ${option.description}`)].join('\n');
	if (isCommandBranch(path)) return [`trsd ${path}`, '', ...commandSpecs.filter((entry) => entry.name.startsWith(`${path} `)).map((entry) => `  ${entry.name}  ${entry.description}`)].join('\n');
	return `Unknown trsd command: ${path}\nRun \`trsd help\` to see the accepted command tree.`;
}
