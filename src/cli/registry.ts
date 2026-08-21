import {
	TREESEED_COMMAND_TREE_V1,
	type CommandLeafDescriptor,
	type CommandNodeDescriptor,
} from '@treeseed/sdk/operator-contracts';
import type { CommandSpec, OptionSpec } from './types.js';

const contextOptions: OptionSpec[] = [
	{ name: 'market', flag: '--market', kind: 'string', description: 'Control-plane profile.' },
	{ name: 'team', flag: '--team', kind: 'string', description: 'Team id or slug.' },
	{ name: 'project', flag: '--project', kind: 'string', description: 'Project id or slug.' },
	{ name: 'provider', flag: '--provider', kind: 'string', description: 'Provider identity.' },
	{ name: 'credential', flag: '--credential', kind: 'string', description: 'Credential identity.' },
	{ name: 'profile', flag: '--profile', kind: 'string', description: 'Workday profile identity.' },
	{ name: 'decision', flag: '--decision', kind: 'string', description: 'Approved decision identity.' },
	{ name: 'projects', flag: '--projects', kind: 'string', description: 'Project scope or comma-separated projects.' },
	{ name: 'start', flag: '--start', kind: 'string', description: 'ISO start time.' },
	{ name: 'end', flag: '--end', kind: 'string', description: 'ISO end time.' },
	{ name: 'duration', flag: '--duration', kind: 'string', description: 'Duration in seconds.' },
	{ name: 'objective', flag: '--objective', kind: 'string', repeatable: true, description: 'Objective filter.' },
	{ name: 'preflight', flag: '--preflight', kind: 'string', description: 'Exact preflight identity.' },
	{ name: 'digest', flag: '--digest', kind: 'string', description: 'Exact preflight digest.' },
	{ name: 'reason', flag: '--reason', kind: 'string', description: 'Audited operator reason.' },
	{ name: 'status', flag: '--status', kind: 'string', description: 'Status filter.' },
	{ name: 'limit', flag: '--limit', kind: 'string', description: 'Page size.' },
	{ name: 'cursor', flag: '--cursor', kind: 'string', description: 'Opaque page cursor.' },
	{ name: 'yes', flag: '--yes', kind: 'boolean', description: 'Confirm authorized automation.' },
	{ name: 'json', flag: '--json', kind: 'boolean', description: 'Emit the stable JSON envelope.' },
];

function add(names: Set<string>, ...values: string[]) { values.forEach((value) => names.add(value)); }

function optionNames(path: string[], leaf: CommandLeafDescriptor) {
	const root = path[0];
	const command = path.join(' ');
	const names = new Set(['json']);
	if (root === 'auth') add(names, 'market');
	if (root === 'agents') add(names, 'market', 'project');
	if (root === 'providers') add(names, 'market', 'team');
	if (root === 'capacity') add(names, 'market', 'team', 'project');
	if (root === 'plans') add(names, 'market', 'team');
	if (root === 'workdays') add(names, 'market', 'team');
	if (root === 'assignments') add(names, 'market', 'team', 'project');
	if (['save', 'stage', 'release', 'status', 'diagnose'].includes(command)) add(names, 'market', 'team', 'project');
	if (/ (?:list|watch)$/u.test(command) || ['capacity status', 'capacity usage', 'capacity ledger', 'capacity audit'].includes(command)) add(names, 'status', 'limit', 'cursor');
	if (command === 'providers diagnose') add(names, 'status');
	if (command === 'providers connect') add(names, 'provider');
	if (command === 'providers credentials revoke') add(names, 'credential');
	if (command === 'plans list') add(names, 'decision');
	if (command === 'workdays plan') add(names, 'profile', 'projects', 'start', 'end', 'duration', 'objective');
	if (['workdays schedules plan', 'workdays schedules start'].includes(command)) add(names, 'profile', 'projects', 'duration');
	if (command === 'workdays start') add(names, 'preflight', 'digest');
	if (/(?:disconnect|approve|reject|pause|resume|stop|cancel|retry|retire)$/u.test(command)) add(names, 'reason');
	if (leaf.kind === 'mutation') names.add('yes');
	return names;
}

function options(path: string[], leaf: CommandLeafDescriptor) {
	const selected = contextOptions.filter((option) => optionNames(path, leaf).has(option.name));
	for (const option of leaf.options ?? []) {
		if (selected.some((candidate) => candidate.flag === option.name)) continue;
		selected.push({ name: option.name.slice(2).replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase()), flag: option.name, kind: option.type, description: option.description });
	}
	return selected;
}

function flatten(nodes: CommandNodeDescriptor[], parent: string[] = []): CommandSpec[] {
	return nodes.flatMap((node) => {
		const path = [...parent, node.segment];
		if (node.nodeType === 'branch') return flatten(node.children, path);
		return [{
			path,
			name: path.join(' '),
			description: node.description,
			kind: node.kind,
			arguments: (node.arguments ?? []).map((argument) => ({ ...argument, required: argument.required === true })),
			options: options(path, node),
			confirmation: node.authorization?.confirmation ?? 'never',
		}];
	});
}

export const commandSpecs = flatten(TREESEED_COMMAND_TREE_V1.commands);
export const commandIndex = new Map(commandSpecs.map((command) => [command.name, command]));

export function resolveCommand(argv: string[]) {
	for (let length = argv.length; length > 0; length -= 1) {
		const command = commandIndex.get(argv.slice(0, length).join(' '));
		if (command) return { command, rest: argv.slice(length) };
	}
	return null;
}

export function isCommandBranch(path: string) {
	return commandSpecs.some((command) => command.name.startsWith(`${path} `));
}
