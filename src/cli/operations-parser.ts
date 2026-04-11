import type { TreeseedCommandOptionSpec, TreeseedOperationSpec, TreeseedParsedInvocation } from './operations-types.ts';

function optionKey(spec: TreeseedCommandOptionSpec) {
	return spec.name;
}

export function parseTreeseedInvocation(command: TreeseedOperationSpec, argv: string[]): TreeseedParsedInvocation {
	const args: TreeseedParsedInvocation['args'] = {};
	const positionals: string[] = [];
	const options = new Map<string, TreeseedCommandOptionSpec>((command.options ?? []).map((spec) => [spec.name, spec]));
	const byFlag = new Map<string, TreeseedCommandOptionSpec>();

	for (const spec of options.values()) {
		const firstToken = spec.flags.split(/[ ,|]+/).find((token) => token.startsWith('--') || token.startsWith('-'));
		if (firstToken) byFlag.set(firstToken, spec);
	}

	const rest = [...argv];
	while (rest.length > 0) {
		const current = rest.shift()!;
		if (current === '--') {
			positionals.push(...rest);
			break;
		}
		if (current.startsWith('-')) {
			const [flag, inlineValue] = current.split('=', 2);
			const spec = byFlag.get(flag);
			if (!spec) {
				throw new Error(`Unknown option: ${flag}`);
			}
			if (spec.kind === 'boolean') {
				args[optionKey(spec)] = true;
				continue;
			}
			const value = inlineValue ?? rest.shift();
			if (!value) {
				throw new Error(`Missing value for ${flag}`);
			}
			if (spec.kind === 'enum' && spec.values && !spec.values.includes(value)) {
				throw new Error(`Invalid value for ${flag}: ${value}. Expected one of ${spec.values.join(', ')}.`);
			}
			if (spec.repeatable) {
				const currentValues = Array.isArray(args[optionKey(spec)]) ? args[optionKey(spec)] as string[] : [];
				args[optionKey(spec)] = [...currentValues, value];
			} else {
				args[optionKey(spec)] = value;
			}
			continue;
		}
		positionals.push(current);
	}

	const messageTailArg = (command.arguments ?? []).find((arg) => arg.kind === 'message_tail');
	if (messageTailArg && positionals.length > 1) {
		const [first, ...restPositional] = positionals;
		return {
			commandName: command.name,
			args,
			positionals: first ? [first, ...restPositional] : restPositional,
			rawArgs: argv,
		};
	}

	return {
		commandName: command.name,
		args,
		positionals,
		rawArgs: argv,
	};
}

export function validateTreeseedInvocation(command: TreeseedOperationSpec, invocation: TreeseedParsedInvocation): string[] {
	const errors: string[] = [];
	const args = command.arguments ?? [];
	const positionals = [...invocation.positionals];

	for (const arg of args) {
		if (arg.kind === 'message_tail') {
			if (positionals.join(' ').trim().length === 0 && arg.required) {
				errors.push(`Missing required argument: ${arg.name}`);
			}
			continue;
		}
		const next = positionals.shift();
		if (!next && arg.required) {
			errors.push(`Missing required argument: ${arg.name}`);
		}
	}

	if (command.name === 'release' || command.name === 'promote') {
		const selected = ['major', 'minor', 'patch'].filter((name) => invocation.args[name] === true);
		if (selected.length !== 1) {
			errors.push(`Treeseed ${command.name} requires exactly one version bump flag: --major, --minor, or --patch.`);
		}
	}

	if (command.name === 'deploy' || command.name === 'publish') {
		if (!invocation.args.environment && !invocation.args.targetBranch && !process.env.CI) {
			errors.push(`Treeseed ${command.name} requires \`--environment local|staging|prod\` or \`--target-branch <branch>\` outside CI.`);
		}
	}

	return errors;
}
