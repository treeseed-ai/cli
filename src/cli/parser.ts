import type { CommandSpec, ParsedInvocation } from './types.js';

export function parseInvocation(command: CommandSpec, argv: string[]): ParsedInvocation {
	const byFlag = new Map(command.options.map((option) => [option.flag, option]));
	const options: ParsedInvocation['options'] = {};
	const args: string[] = [];
	const remaining = [...argv];
	while (remaining.length) {
		const current = remaining.shift()!;
		if (current === '--') { args.push(...remaining); break; }
		if (!current.startsWith('-')) { args.push(current); continue; }
		const [flag, inline] = current.split('=', 2);
		const spec = byFlag.get(flag);
		if (!spec) throw new Error(`Unknown option: ${flag}`);
		if (spec.kind === 'boolean') { options[spec.name] = true; continue; }
		const value = inline ?? remaining.shift();
		if (!value) throw new Error(`Missing value for ${flag}`);
		if (spec.repeatable) options[spec.name] = [...(Array.isArray(options[spec.name]) ? options[spec.name] as string[] : []), value];
		else options[spec.name] = value;
	}
	const missing = command.arguments.filter((argument, index) => argument.required && !args[index]);
	if (missing.length) throw new Error(`Missing required argument: ${missing.map((argument) => argument.name).join(', ')}`);
	return { command, arguments: args, options };
}
