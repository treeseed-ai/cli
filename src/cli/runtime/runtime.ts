import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findNearestWorkspaceRoot, resolveWorkflowPaths } from '@treeseed/sdk/workflow-support';
import { OperationsSdk as SdkOperationsRuntime } from '@treeseed/sdk/operations';
import type {
	CommandContext,
	HandlerResolver,
	OperationRequest,
	OperationResult,
	OperationSpec,
	Spawner,
	Writer,
} from '../operations/operations-types.ts';
import { COMMAND_HANDLERS } from '../support/registry.js';
import { renderHelp, renderUsage, suggestCommands } from '../operations/operations-help.ts';
import { renderHelpInk, shouldUseInkHelp } from '../support/help-ui.js';
import { parseInvocation, validateInvocation } from '../operations/operations-parser.ts';
import { findOperation, TRESEED_OPERATION_SPECS } from '../operations/operations-registry.ts';
import {
	colorizeCliOutput,
	defaultSpawn,
	defaultWrite,
	resolveColorEnabled,
	stripGlobalFlags,
} from './runtime-output.js';

export { colorizeCliOutput } from './runtime-output.js';

const require = createRequire(import.meta.url);

function isHelpFlag(value: string | undefined) {
	return value === '--help' || value === '-h';
}

function shouldRenderCommandHelp(spec: OperationSpec, argv: string[]) {
	if (spec.group !== 'Passthrough') {
		return argv.some(isHelpFlag);
	}
	const separatorIndex = argv.indexOf('--');
	const Args = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
	return Args.some(isHelpFlag);
}

function resolveNestedDevHelpTarget(argv: string[]) {
	const managedSubcommands = new Set(['start', 'status', 'logs', 'stop', 'restart']);
	const subcommand = argv.find((arg) => !arg.startsWith('-') && managedSubcommands.has(arg));
	return subcommand ? `dev ${subcommand}` : null;
}

function resolveCommandHelpTarget(spec: OperationSpec, argv: string[]) {
	if (spec.name === 'dev') {
		return resolveNestedDevHelpTarget(argv) ?? spec.name;
	}
	return spec.name;
}

function resolveExplicitHelpTarget(args: string[]) {
	const helpArgs = args.filter((arg) => !arg.startsWith('-'));
	if (helpArgs.length === 0) return null;
	for (let length = Math.min(3, helpArgs.length); length > 0; length -= 1) {
		const candidate = helpArgs.slice(0, length).join(' ');
		if (findOperation(candidate)) {
			return candidate;
		}
	}
	return helpArgs[0] ?? null;
}

function resolveCoreAgentCliEntrypoint(cwd: string) {
	const unavailableMessage = 'Treeseed agent commands require the integrated `@treeseed/core` runtime. '
		+ 'Install `@treeseed/core` in the current project or run the CLI inside a Treeseed workspace.';
	const workspaceRoot = findNearestWorkspaceRoot(cwd) ?? cwd;
	const workspacePackageJsonPath = resolve(workspaceRoot, 'packages', 'core', 'package.json');
	const siblingPackageJsonPath = resolve(cwd, '..', 'core', 'package.json');
	const installedPackageJsonPath = resolve(cwd, 'node_modules', '@treeseed', 'core', 'package.json');
	let packageJsonPath = workspacePackageJsonPath;
	if (!existsSync(packageJsonPath)) {
		packageJsonPath = existsSync(siblingPackageJsonPath) ? siblingPackageJsonPath : installedPackageJsonPath;
	}
	if (!existsSync(packageJsonPath)) {
		try {
			const resolvedPath = require.resolve('@treeseed/core', { paths: [cwd] });
			let currentDir = dirname(resolvedPath);
			while (!existsSync(resolve(currentDir, 'package.json'))) {
				const parentDir = dirname(currentDir);
				if (parentDir === currentDir) {
					throw new Error('Unable to resolve the installed @treeseed/core package root.');
				}
				currentDir = parentDir;
			}
			packageJsonPath = resolve(currentDir, 'package.json');
		} catch {
			throw new Error(unavailableMessage);
		}
	}

	const packageRoot = dirname(packageJsonPath);
	const sourceEntrypoint = resolve(packageRoot, 'src', 'agents', 'cli.ts');
	if (existsSync(sourceEntrypoint)) {
		return pathToFileURL(sourceEntrypoint).href;
	}

	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
		exports?: Record<string, string | { default?: string }>;
	};
	const exportedEntrypoint = packageJson.exports?.['./agent/cli'];
	const distRelativePath = typeof exportedEntrypoint === 'string'
		? exportedEntrypoint
		: exportedEntrypoint?.default ?? './dist/agents/cli.js';
	const distEntrypoint = resolve(packageRoot, distRelativePath);
	if (!existsSync(distEntrypoint)) {
		throw new Error(unavailableMessage);
	}
	return pathToFileURL(distEntrypoint).href;
}

const sdkOperationsRuntime = new SdkOperationsRuntime();

function formatValidationError(spec: OperationSpec, errors: string[]) {
	return [
		...errors,
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

export function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const colorEnabled = resolveColorEnabled([], overrides.env ?? process.env, overrides.colorEnabled);
	const rawWrite = overrides.write ?? (defaultWrite as Writer);
	return {
		cwd: overrides.cwd ?? process.cwd(),
		env: overrides.env ?? process.env,
		write: overrides.write
			? rawWrite
			: ((output, stream) => rawWrite(colorizeCliOutput(output, colorEnabled), stream)) as Writer,
		spawn: overrides.spawn ?? (defaultSpawn as Spawner),
		outputFormat: overrides.outputFormat ?? 'human',
		interactiveUi: overrides.interactiveUi ?? (overrides.write == null),
		colorEnabled,
		prompt: overrides.prompt,
		confirm: overrides.confirm,
	};
}

export function writeCommandResult(result: OperationResult | { exitCode?: number; stdout?: string[]; stderr?: string[]; report?: Record<string, unknown> | null; suppressJsonResult?: boolean }, context: CommandContext) {
	if (context.outputFormat === 'json') {
		if (result.suppressJsonResult === true) {
			return result.exitCode ?? 0;
		}
		const payload = result.report ?? {
			ok: (result.exitCode ?? 0) === 0,
			stdout: result.stdout ?? [],
			stderr: result.stderr ?? [],
		};
		context.write(JSON.stringify(payload, null, 2), (result.exitCode ?? 0) === 0 ? 'stdout' : 'stderr');
		return result.exitCode ?? 0;
	}

	for (const line of result.stdout ?? []) {
		context.write(line, 'stdout');
	}
	for (const line of result.stderr ?? []) {
		context.write(line, 'stderr');
	}
	return result.exitCode ?? 0;
}

export type OperationsSdkOptions = {
	resolveHandler?: HandlerResolver;
};

export class OperationsSdk {
	constructor(private readonly options: OperationsSdkOptions = {}) {}

	listOperations() {
		return [...TRESEED_OPERATION_SPECS];
	}

	findOperation(name: string | null | undefined) {
		return findOperation(name);
	}

	parseInvocation(spec: OperationSpec, argv: string[]) {
		return parseInvocation(spec, argv);
	}

	validateInvocation(spec: OperationSpec, argv: string[]) {
		return validateInvocation(spec, parseInvocation(spec, argv));
	}

	private async executeHandler(spec: OperationSpec, argv: string[], context: CommandContext) {
		try {
			const invocation = parseInvocation(spec, argv);
			const errors = validateInvocation(spec, invocation);
			const handlerContext: CommandContext = {
				...context,
				outputFormat: invocation.args.json === true ? 'json' : (context.outputFormat ?? 'human'),
			};
			if (errors.length > 0) {
				return writeCommandResult({
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
				return writeCommandResult({ exitCode: 1, stderr: [`Treeseed command \`${spec.name}\` is missing a handler binding.`] }, handlerContext);
			}
			const handler = this.options.resolveHandler?.(handlerName) ?? null;
			if (!handler) {
				return writeCommandResult({
					exitCode: 1,
					stderr: [`Treeseed command \`${spec.name}\` is not executable in this runtime.`],
					report: {
						command: spec.name,
						ok: false,
						error: `No handler registered for ${handlerName}.`,
					},
				}, handlerContext);
			}
			const result = await handler(invocation, handlerContext);
			return writeCommandResult(result, handlerContext);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const wantsJson = argv.includes('--json');
			return writeCommandResult({
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

	private executeAdapter(spec: OperationSpec, argv: string[], context: CommandContext) {
		const invocation = spec.options?.length || spec.arguments?.length
			? parseInvocation(spec, argv)
			: {
				commandName: spec.name,
				args: {},
				positionals: argv.filter((value) => value !== '--'),
				rawArgs: argv,
			};
		const input = spec.buildAdapterInput?.(invocation, context) ?? {};
		const adapterContext = {
			...context,
			outputFormat: invocation.args.json === true ? 'json' : (context.outputFormat ?? 'human'),
		};

		return sdkOperationsRuntime.execute(
			{ operationName: spec.name, input },
			{
				cwd: adapterContext.cwd,
				env: adapterContext.env,
				write: adapterContext.write,
				spawn: adapterContext.spawn,
				outputFormat: adapterContext.outputFormat,
				transport: 'cli',
			},
		).then((result) => writeCommandResult(result, adapterContext))
			.catch((error) => writeCommandResult({
				exitCode: 1,
				stderr: [error instanceof Error ? error.message : String(error)],
			}, adapterContext));
	}

	private async executeAgents(argv: string[], context: CommandContext) {
		try {
			const { runAgentCli } = await import(resolveCoreAgentCliEntrypoint(context.cwd));
			return await runAgentCli(argv, {
				cwd: context.cwd,
				env: context.env,
				outputFormat: context.outputFormat,
				write: context.write,
			});
		} catch (error) {
			return writeCommandResult({
				exitCode: 1,
				stderr: [error instanceof Error ? error.message : String(error)],
				report: {
					command: 'agents',
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
			}, context);
		}
	}

	async executeOperation(request: OperationRequest, overrides: Partial<CommandContext> = {}) {
		const context = createCommandContext(overrides);
		const argv = request.argv ?? [];
		const commandName = request.commandName;

		const spec = findOperation(commandName);
		if (!spec) {
			if (shouldUseInkHelp(context)) {
				const helpExitCode = await renderHelpInk(commandName, context);
				if (typeof helpExitCode === 'number') {
					return helpExitCode;
				}
			}
			const suggestions = suggestCommands(commandName);
			const lines = [`Unknown treeseed command: ${commandName}`];
			if (suggestions.length > 0) {
				lines.push(`Did you mean: ${suggestions.map((value) => `\`${value}\``).join(', ')}?`);
			}
			lines.push('Run `treeseed help` to see the full command list.');
			return writeCommandResult({ exitCode: 1, stderr: [lines.join('\n')] }, context);
		}

		if (shouldRenderCommandHelp(spec, argv)) {
			const helpTarget = resolveCommandHelpTarget(spec, argv);
			if (shouldUseInkHelp(context)) {
				const helpExitCode = await renderHelpInk(helpTarget, context);
				if (typeof helpExitCode === 'number') {
					return helpExitCode;
				}
			}
			context.write(renderHelp(helpTarget), 'stdout');
			return 0;
		}

		return spec.executionMode === 'adapter'
			? this.executeAdapter(spec, argv, context)
			: spec.executionMode === 'delegate'
				? this.executeAgents(argv, context)
				: this.executeHandler(spec, argv, context);
	}

	async run(argv: string[], overrides: Partial<CommandContext> = {}) {
		const context = createCommandContext(overrides);
		const [firstArg, ...restArgs] = argv;

		if (!firstArg || isHelpFlag(firstArg) || firstArg === 'help') {
			const commandName = firstArg === 'help' ? resolveExplicitHelpTarget(restArgs) : null;
			if (shouldUseInkHelp(context)) {
				const helpExitCode = await renderHelpInk(commandName, context);
				if (typeof helpExitCode === 'number') {
					return helpExitCode;
				}
			}
			const helpText = renderHelp(commandName);
			context.write(helpText, 'stdout');
			return commandName && helpText.startsWith('Unknown treeseed command:') ? 1 : 0;
		}

		return this.executeOperation({ commandName: firstArg, argv: restArgs }, context);
	}
}

function formatProjectError(spec: OperationSpec) {
	return [
		`Treeseed command \`${spec.name}\` must be run inside a Treeseed project.`,
		'No ancestor directory containing `treeseed.site.yaml` was found.',
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

function commandNeedsProjectRoot(spec: OperationSpec) {
	return !new Set([
		'init',
		'export',
		'install',
		'auth:login',
		'auth:logout',
		'auth:whoami',
		'market',
		'teams',
		'projects',
		'capacity',
		'packs',
		'template',
		'scene',
	]).has(spec.name);
}

export function resolveCommandCwd(spec: OperationSpec, cwd: string) {
	if (!commandNeedsProjectRoot(spec)) {
		return {
			cwd,
			resolvedProjectRoot: null,
			resolvedWorkspaceRoot: null,
		};
	}

	const workflowPaths = resolveWorkflowPaths(cwd);
	const resolvedProjectRoot = workflowPaths.tenantRoot;
	const resolvedWorkspaceRoot = resolvedProjectRoot ? findNearestWorkspaceRoot(resolvedProjectRoot) : null;

	return {
		cwd: resolvedProjectRoot ?? cwd,
		resolvedProjectRoot,
		resolvedWorkspaceRoot,
	};
}

const cliOperationsSdk = new OperationsSdk({
	resolveHandler: (handlerName) => COMMAND_HANDLERS[handlerName as keyof typeof COMMAND_HANDLERS] ?? null,
});

export async function executeCommand(commandName: string, argv: string[], context: CommandContext) {
	const cleanArgv = stripGlobalFlags(argv);
	const commandContext = {
		...context,
		colorEnabled: resolveColorEnabled(argv, context.env ?? process.env, context.colorEnabled),
	};
	const spec = cliOperationsSdk.findOperation(commandName);
	if (!spec) {
		return cliOperationsSdk.executeOperation({ commandName, argv: cleanArgv }, commandContext);
	}
	if (shouldRenderCommandHelp(spec, cleanArgv)) {
		return cliOperationsSdk.executeOperation({ commandName, argv: cleanArgv }, commandContext);
	}

	const resolved = resolveCommandCwd(spec, commandContext.cwd);
	if (commandNeedsProjectRoot(spec) && !resolved.resolvedProjectRoot) {
		return writeCommandResult({
			exitCode: 1,
			stderr: [formatProjectError(spec)],
			report: {
				command: spec.name,
				ok: false,
				error: `No ancestor containing treeseed.site.yaml was found from ${commandContext.cwd}.`,
				hint: `treeseed help ${spec.name}`,
			},
		}, { ...commandContext, outputFormat: cleanArgv.includes('--json') ? 'json' : (commandContext.outputFormat ?? 'human') });
	}

	return cliOperationsSdk.executeOperation({ commandName, argv: cleanArgv }, { ...commandContext, cwd: resolved.cwd });
}

export async function runCommandLine(argv: string[], overrides: Partial<CommandContext> = {}) {
	const cleanArgv = stripGlobalFlags(argv);
	const colorEnabled = resolveColorEnabled(argv, overrides.env ?? process.env, overrides.colorEnabled);
	const [firstArg] = cleanArgv;
	const spec = firstArg ? cliOperationsSdk.findOperation(firstArg) : null;
	if (!spec) {
		return cliOperationsSdk.run(cleanArgv, { ...overrides, colorEnabled });
	}
	if (shouldRenderCommandHelp(spec, cleanArgv.slice(1))) {
		return cliOperationsSdk.run(cleanArgv, { ...overrides, colorEnabled });
	}

	const baseCwd = overrides.cwd ?? process.cwd();
	const resolved = resolveCommandCwd(spec, baseCwd);
	if (commandNeedsProjectRoot(spec) && !resolved.resolvedProjectRoot) {
		return writeCommandResult({
			exitCode: 1,
			stderr: [formatProjectError(spec)],
			report: {
				command: spec.name,
				ok: false,
				error: `No ancestor containing treeseed.site.yaml was found from ${baseCwd}.`,
				hint: `treeseed help ${spec.name}`,
			},
		}, createCommandContext({
			...overrides,
			colorEnabled,
			outputFormat: cleanArgv.includes('--json') ? 'json' : (overrides.outputFormat ?? 'human'),
		}));
	}
	const contextOverrides = commandNeedsProjectRoot(spec) && resolved.resolvedProjectRoot
		? { ...overrides, cwd: resolved.cwd, colorEnabled }
		: { ...overrides, colorEnabled };

	return cliOperationsSdk.run(cleanArgv, contextOverrides);
}
