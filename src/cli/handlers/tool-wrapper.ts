import {
	createTreeseedManagedToolEnv,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedToolCommand,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { workflowErrorResult } from './workflow.js';

type WrappedToolName = 'gh' | 'railway' | 'wrangler';
type TreeseedEnvironmentScope = 'local' | 'staging' | 'prod';

const WRAPPED_TOOLS = new Set<string>(['gh', 'railway', 'wrangler']);
const ENVIRONMENT_SCOPES = new Set<string>(['local', 'staging', 'prod']);

function wrappedToolName(value: string): WrappedToolName {
	if (WRAPPED_TOOLS.has(value)) {
		return value as WrappedToolName;
	}
	throw new Error(`Unsupported Treeseed tool wrapper: ${value}`);
}

function wrapperScope(value: unknown): TreeseedEnvironmentScope {
	if (typeof value === 'string' && ENVIRONMENT_SCOPES.has(value)) {
		return value as TreeseedEnvironmentScope;
	}
	return 'staging';
}

export const handleToolWrapper: TreeseedCommandHandler = (invocation, context) => {
	try {
		const toolName = wrappedToolName(invocation.commandName);
		const scope = wrapperScope(invocation.args.environment);
		const launchEnv = resolveTreeseedLaunchEnvironment({
			tenantRoot: context.cwd,
			scope,
			baseEnv: { ...process.env, ...(context.env ?? {}) },
		});
		const managedEnv = createTreeseedManagedToolEnv({
			...process.env,
			...(context.env ?? {}),
			...launchEnv,
			TREESEED_ACTIVE_ENVIRONMENT: scope,
		});
		const resolved = resolveTreeseedToolCommand(toolName, { env: managedEnv });
		if (!resolved) {
			return {
				exitCode: 1,
				stderr: [
					`Treeseed managed tool \`${toolName}\` is not installed or could not be resolved.`,
					'Run `npx trsd install --json` and retry the wrapper command.',
				],
				report: {
					command: toolName,
					ok: false,
					scope,
					error: `Unable to resolve ${toolName}.`,
				},
			};
		}

		const targetArgs = invocation.positionals;
		const result = context.spawn(resolved.command, [...resolved.argsPrefix, ...targetArgs], {
			cwd: context.cwd,
			env: managedEnv,
			stdio: 'inherit',
		});
		return {
			exitCode: result.status ?? 1,
			suppressJsonResult: true,
			report: {
				command: toolName,
				ok: (result.status ?? 1) === 0,
				scope,
				executable: resolved.command,
				binaryPath: resolved.binaryPath,
				argsPrefix: resolved.argsPrefix,
				args: targetArgs,
			},
		};
	} catch (error) {
		return workflowErrorResult(error);
	}
};
