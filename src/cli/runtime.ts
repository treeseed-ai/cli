import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findNearestTreeseedRoot, findNearestTreeseedWorkspaceRoot } from '@treeseed/sdk/workflow-support';
import { TreeseedOperationsSdk as SdkOperationsRuntime } from '@treeseed/sdk/operations';
import type {
	TreeseedCommandContext,
	TreeseedHandlerResolver,
	TreeseedOperationRequest,
	TreeseedOperationResult,
	TreeseedOperationSpec,
	TreeseedSpawner,
	TreeseedWriter,
} from './operations-types.ts';
import { COMMAND_HANDLERS } from './registry.js';
import { renderTreeseedHelp, renderUsage, suggestTreeseedCommands } from './operations-help.ts';
import { parseTreeseedInvocation, validateTreeseedInvocation } from './operations-parser.ts';
import { findTreeseedOperation, TRESEED_OPERATION_SPECS } from './operations-registry.ts';

const require = createRequire(import.meta.url);

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

function resolveCoreAgentCliEntrypoint(cwd: string) {
	const workspaceRoot = findNearestTreeseedWorkspaceRoot(cwd) ?? cwd;
	const workspacePackageJsonPath = resolve(workspaceRoot, 'packages', 'core', 'package.json');
	const siblingPackageJsonPath = resolve(cwd, '..', 'core', 'package.json');
	const installedPackageJsonPath = resolve(cwd, 'node_modules', '@treeseed', 'core', 'package.json');
	let packageJsonPath = workspacePackageJsonPath;
	if (!existsSync(packageJsonPath)) {
		packageJsonPath = existsSync(siblingPackageJsonPath) ? siblingPackageJsonPath : installedPackageJsonPath;
	}
	if (!existsSync(packageJsonPath)) {
		const resolvedPath = require.resolve('@treeseed/core', { paths: [cwd, process.cwd()] });
		let currentDir = dirname(resolvedPath);
		while (!existsSync(resolve(currentDir, 'package.json'))) {
			const parentDir = dirname(currentDir);
			if (parentDir === currentDir) {
				throw new Error('Unable to resolve the installed @treeseed/core package root.');
			}
			currentDir = parentDir;
		}
		packageJsonPath = resolve(currentDir, 'package.json');
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
	return pathToFileURL(resolve(packageRoot, distRelativePath)).href;
}

const sdkOperationsRuntime = new SdkOperationsRuntime();

function formatValidationError(spec: TreeseedOperationSpec, errors: string[]) {
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
		prompt: overrides.prompt,
		confirm: overrides.confirm,
	};
}

export function writeTreeseedResult(result: TreeseedOperationResult | { exitCode?: number; stdout?: string[]; stderr?: string[]; report?: Record<string, unknown> | null }, context: TreeseedCommandContext) {
	if (context.outputFormat === 'json') {
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

export type TreeseedOperationsSdkOptions = {
	resolveHandler?: TreeseedHandlerResolver;
};

export class TreeseedOperationsSdk {
	constructor(private readonly options: TreeseedOperationsSdkOptions = {}) {}

	listOperations() {
		return [...TRESEED_OPERATION_SPECS];
	}

	findOperation(name: string | null | undefined) {
		return findTreeseedOperation(name);
	}

	parseInvocation(spec: TreeseedOperationSpec, argv: string[]) {
		return parseTreeseedInvocation(spec, argv);
	}

	validateInvocation(spec: TreeseedOperationSpec, argv: string[]) {
		return validateTreeseedInvocation(spec, parseTreeseedInvocation(spec, argv));
	}

	private async executeHandler(spec: TreeseedOperationSpec, argv: string[], context: TreeseedCommandContext) {
		try {
			const invocation = parseTreeseedInvocation(spec, argv);
			const errors = validateTreeseedInvocation(spec, invocation);
			const handlerContext: TreeseedCommandContext = {
				...context,
				outputFormat: invocation.args.json === true ? 'json' : (context.outputFormat ?? 'human'),
			};
			if (errors.length > 0) {
				return writeTreeseedResult({
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
				return writeTreeseedResult({ exitCode: 1, stderr: [`Treeseed command \`${spec.name}\` is missing a handler binding.`] }, handlerContext);
			}
			const handler = this.options.resolveHandler?.(handlerName) ?? null;
			if (!handler) {
				return writeTreeseedResult({
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
			return writeTreeseedResult(result, handlerContext);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const wantsJson = argv.includes('--json');
			return writeTreeseedResult({
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

	private executeAdapter(spec: TreeseedOperationSpec, argv: string[], context: TreeseedCommandContext) {
		const invocation = spec.options?.length || spec.arguments?.length
			? parseTreeseedInvocation(spec, argv)
			: {
				commandName: spec.name,
				args: {},
				positionals: argv.filter((value) => value !== '--'),
				rawArgs: argv,
			};
		const input = spec.buildAdapterInput?.(invocation, context) ?? {};

		return sdkOperationsRuntime.execute(
			{ operationName: spec.name, input },
			{
				cwd: context.cwd,
				env: context.env,
				write: context.write,
				spawn: context.spawn,
				outputFormat: context.outputFormat,
				transport: 'cli',
			},
		).then((result) => writeTreeseedResult(result, context))
			.catch((error) => writeTreeseedResult({
				exitCode: 1,
				stderr: [error instanceof Error ? error.message : String(error)],
			}, context));
	}

	private async executeAgents(argv: string[], context: TreeseedCommandContext) {
		try {
			const { runTreeseedAgentCli } = await import(resolveCoreAgentCliEntrypoint(context.cwd));
			return await runTreeseedAgentCli(argv, {
				cwd: context.cwd,
				env: context.env,
				outputFormat: context.outputFormat,
				write: context.write,
			});
		} catch (error) {
			return writeTreeseedResult({
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

	async executeOperation(request: TreeseedOperationRequest, overrides: Partial<TreeseedCommandContext> = {}) {
		const context = createTreeseedCommandContext(overrides);
		const argv = request.argv ?? [];
		const commandName = request.commandName;

		if (commandName === 'agents') {
			return this.executeAgents(argv, context);
		}

		const spec = findTreeseedOperation(commandName);
		if (!spec) {
			const suggestions = suggestTreeseedCommands(commandName);
			const lines = [`Unknown treeseed command: ${commandName}`];
			if (suggestions.length > 0) {
				lines.push(`Did you mean: ${suggestions.map((value) => `\`${value}\``).join(', ')}?`);
			}
			lines.push('Run `treeseed help` to see the full command list.');
			return writeTreeseedResult({ exitCode: 1, stderr: [lines.join('\n')] }, context);
		}

		if (argv.some(isHelpFlag)) {
			context.write(renderTreeseedHelp(spec.name), 'stdout');
			return 0;
		}

		return spec.executionMode === 'adapter'
			? this.executeAdapter(spec, argv, context)
			: this.executeHandler(spec, argv, context);
	}

	async run(argv: string[], overrides: Partial<TreeseedCommandContext> = {}) {
		const context = createTreeseedCommandContext(overrides);
		const [firstArg, ...restArgs] = argv;

		if (!firstArg || isHelpFlag(firstArg) || firstArg === 'help') {
			const commandName = firstArg === 'help' ? (restArgs[0] ?? null) : null;
			const helpText = renderTreeseedHelp(commandName);
			context.write(helpText, 'stdout');
			return commandName && helpText.startsWith('Unknown treeseed command:') ? 1 : 0;
		}

		return this.executeOperation({ commandName: firstArg, argv: restArgs }, context);
	}
}

function formatProjectError(spec: TreeseedOperationSpec) {
	return [
		`Treeseed command \`${spec.name}\` must be run inside a Treeseed project.`,
		'No ancestor directory containing `treeseed.site.yaml` was found.',
		`Usage: ${renderUsage(spec)}`,
		`Run \`treeseed help ${spec.name}\` for details.`,
	].join('\n');
}

function commandNeedsProjectRoot(spec: TreeseedOperationSpec) {
	return spec.name !== 'init';
}

export function resolveTreeseedCommandCwd(spec: TreeseedOperationSpec, cwd: string) {
	if (!commandNeedsProjectRoot(spec)) {
		return {
			cwd,
			resolvedProjectRoot: null,
			resolvedWorkspaceRoot: null,
		};
	}

	const resolvedProjectRoot = findNearestTreeseedRoot(cwd);
	const resolvedWorkspaceRoot = resolvedProjectRoot ? findNearestTreeseedWorkspaceRoot(resolvedProjectRoot) : null;

	return {
		cwd: resolvedProjectRoot ?? cwd,
		resolvedProjectRoot,
		resolvedWorkspaceRoot,
	};
}

const cliOperationsSdk = new TreeseedOperationsSdk({
	resolveHandler: (handlerName) => COMMAND_HANDLERS[handlerName as keyof typeof COMMAND_HANDLERS] ?? null,
});

export async function executeTreeseedCommand(commandName: string, argv: string[], context: TreeseedCommandContext) {
	const spec = cliOperationsSdk.findOperation(commandName);
	if (!spec) {
		return cliOperationsSdk.executeOperation({ commandName, argv }, context);
	}
	if (argv.some(isHelpFlag)) {
		return cliOperationsSdk.executeOperation({ commandName, argv }, context);
	}

	const resolved = resolveTreeseedCommandCwd(spec, context.cwd);
	if (commandNeedsProjectRoot(spec) && !resolved.resolvedProjectRoot) {
		return writeTreeseedResult({
			exitCode: 1,
			stderr: [formatProjectError(spec)],
			report: {
				command: spec.name,
				ok: false,
				error: `No ancestor containing treeseed.site.yaml was found from ${context.cwd}.`,
				hint: `treeseed help ${spec.name}`,
			},
		}, { ...context, outputFormat: argv.includes('--json') ? 'json' : (context.outputFormat ?? 'human') });
	}

	return cliOperationsSdk.executeOperation({ commandName, argv }, { ...context, cwd: resolved.cwd });
}

export async function runTreeseedCli(argv: string[], overrides: Partial<TreeseedCommandContext> = {}) {
	const [firstArg] = argv;
	const spec = firstArg ? cliOperationsSdk.findOperation(firstArg) : null;
	if (!spec) {
		return cliOperationsSdk.run(argv, overrides);
	}
	if (argv.slice(1).some(isHelpFlag)) {
		return cliOperationsSdk.run(argv, overrides);
	}

	const baseCwd = overrides.cwd ?? process.cwd();
	const resolved = resolveTreeseedCommandCwd(spec, baseCwd);
	if (commandNeedsProjectRoot(spec) && !resolved.resolvedProjectRoot) {
		return writeTreeseedResult({
			exitCode: 1,
			stderr: [formatProjectError(spec)],
			report: {
				command: spec.name,
				ok: false,
				error: `No ancestor containing treeseed.site.yaml was found from ${baseCwd}.`,
				hint: `treeseed help ${spec.name}`,
			},
		}, createTreeseedCommandContext({
			...overrides,
			outputFormat: argv.includes('--json') ? 'json' : (overrides.outputFormat ?? 'human'),
		}));
	}
	const contextOverrides = commandNeedsProjectRoot(spec) && resolved.resolvedProjectRoot
		? { ...overrides, cwd: resolved.cwd }
		: overrides;

	return cliOperationsSdk.run(argv, contextOverrides);
}
