import { spawnSync } from 'node:child_process';
import { isWorkspaceRoot, packageScriptPath } from '../../scripts/package-tools.ts';
import { writeResult } from './handlers/utils.js';
import { renderTreeseedHelp, renderUsage, suggestTreeseedCommands } from './help.js';
import { parseTreeseedInvocation, validateTreeseedInvocation } from './parser.js';
import { COMMAND_HANDLERS, findCommandSpec } from './registry.js';
import type { TreeseedCommandContext, TreeseedCommandSpec, TreeseedSpawner, TreeseedWriter } from './types.js';

function isHelpFlag(value: string | undefined) {
	return value === '--help' || value === '-h';
}

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

function defaultSpawn(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: 'inherit' }) {
	return spawnSync(command, args, options);
}

function formatValidationError(spec: TreeseedCommandSpec, errors: string[]) {
	return [
		...errors,
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

export function createTreeseedCommandContext(overrides: Partial<TreeseedCommandContext> = {}): TreeseedCommandContext {
	return {
		cwd: overrides.cwd ?? process.cwd(),
		env: overrides.env ?? process.env,
		write: overrides.write ?? (defaultWrite as TreeseedWriter),
		spawn: overrides.spawn ?? (defaultSpawn as TreeseedSpawner),
		outputFormat: overrides.outputFormat ?? 'human',
	};
}

function resolveAdapter(spec: TreeseedCommandSpec, cwd: string) {
	const adapter = spec.adapter;
	if (!adapter) return { error: `Treeseed command \`${spec.name}\` is missing adapter metadata.` };
	if (adapter.requireWorkspaceRoot && !isWorkspaceRoot(cwd)) {
		return {
			error: [
				`Treeseed command \`${spec.name}\` must be run from a workspace root.`,
				`Usage: ${renderUsage(spec)}`,
				`Run \`treeseed help ${spec.name}\` for details.`,
			].join('\n'),
		};
	}

	const scriptName = adapter.workspaceScript || adapter.directScript
		? (isWorkspaceRoot(cwd) ? (adapter.workspaceScript ?? adapter.script) : (adapter.directScript ?? adapter.script))
		: adapter.script;

	return {
		scriptPath: packageScriptPath(scriptName),
		extraArgs: adapter.extraArgs ?? [],
		rewriteArgs: adapter.rewriteArgs,
	};
}

async function executeHandler(spec: TreeseedCommandSpec, argv: string[], context: TreeseedCommandContext) {
	try {
		const invocation = parseTreeseedInvocation(spec, argv);
		const errors = validateTreeseedInvocation(spec, invocation);
		const handlerContext: TreeseedCommandContext = {
			...context,
			outputFormat: invocation.args.json === true ? 'json' : (context.outputFormat ?? 'human'),
		};
		if (errors.length > 0) {
			return writeResult({
				exitCode: 1,
				stderr: [formatValidationError(spec, errors)],
				report: {
					command: spec.name,
					ok: false,
					error: errors.join(' '),
					errors,
					usage: renderUsage(spec),
				},
			}, handlerContext);
		}

		const handlerName = spec.handlerName;
		if (!handlerName) {
			return writeResult({ exitCode: 1, stderr: [`Treeseed command \`${spec.name}\` is missing a handler binding.`] }, handlerContext);
		}

		const handler = COMMAND_HANDLERS[handlerName as keyof typeof COMMAND_HANDLERS];
		const result = await handler(invocation, handlerContext);
		return writeResult(result, handlerContext);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const wantsJson = argv.includes('--json');
		return writeResult({
			exitCode: 1,
			stderr: [message, `Run \`treeseed help ${spec.name}\` for details.`],
			report: {
				command: spec.name,
				ok: false,
				error: message,
				hint: `treeseed help ${spec.name}`,
			},
		}, { ...context, outputFormat: wantsJson ? 'json' : (context.outputFormat ?? 'human') });
	}
}

function executeAdapter(spec: TreeseedCommandSpec, argv: string[], context: TreeseedCommandContext) {
	const resolved = resolveAdapter(spec, context.cwd);
	if ('error' in resolved) {
		return writeResult({ exitCode: 1, stderr: [resolved.error] }, context);
	}

	const rewritten = resolved.rewriteArgs ? resolved.rewriteArgs(argv) : argv;
	const result = context.spawn(process.execPath, [resolved.scriptPath, ...resolved.extraArgs, ...rewritten], {
		cwd: context.cwd,
		env: { ...context.env },
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

function executeAgents(argv: string[], context: TreeseedCommandContext) {
	if (argv.some(isHelpFlag)) {
		context.write([
			'agents  Run the Treeseed agents entrypoint.',
			'',
			'Usage',
			'  treeseed agents [args...]',
			'',
			'Notes',
			'  - Delegates directly to the installed treeseed-agents command.',
		].join('\n'), 'stdout');
		return 0;
	}

	const command = process.platform === 'win32' ? 'treeseed-agents.cmd' : 'treeseed-agents';
	const result = context.spawn(command, argv, {
		cwd: context.cwd,
		env: { ...context.env },
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

export async function executeTreeseedCommand(commandName: string, argv: string[], context: TreeseedCommandContext) {
	if (commandName === 'agents') {
		return executeAgents(argv, context);
	}

	const spec = findCommandSpec(commandName);
	if (!spec) {
		const suggestions = suggestTreeseedCommands(commandName);
		const lines = [`Unknown treeseed command: ${commandName}`];
		if (suggestions.length > 0) {
			lines.push(`Did you mean: ${suggestions.map((value) => `\`${value}\``).join(', ')}?`);
		}
		lines.push('Run `treeseed help` to see the full command list.');
		return writeResult({ exitCode: 1, stderr: [lines.join('\n')] }, context);
	}

	if (argv.some(isHelpFlag)) {
		context.write(renderTreeseedHelp(spec.name), 'stdout');
		return 0;
	}

	return spec.executionMode === 'adapter'
		? executeAdapter(spec, argv, context)
		: executeHandler(spec, argv, context);
}

export async function runTreeseedCli(argv: string[], overrides: Partial<TreeseedCommandContext> = {}) {
	const context = createTreeseedCommandContext(overrides);
	const [firstArg, ...restArgs] = argv;

	if (!firstArg || isHelpFlag(firstArg) || firstArg === 'help') {
		const commandName = firstArg === 'help' ? (restArgs[0] ?? null) : null;
		const helpText = renderTreeseedHelp(commandName);
		context.write(helpText, 'stdout');
		return commandName && helpText.startsWith('Unknown treeseed command:') ? 1 : 0;
	}

	return executeTreeseedCommand(firstArg, restArgs, context);
}
