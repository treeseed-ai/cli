import {
	createTreeseedManagedToolEnv,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedToolCommand,
} from '@treeseed/sdk/workflow-support';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

function railwayEnvironmentName(scope: TreeseedEnvironmentScope) {
	return scope === 'prod' ? 'production' : scope;
}

function findRailwayProjectId(value: unknown): string | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const found = findRailwayProjectId(entry);
			if (found) {
				return found;
			}
		}
		return null;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.projectId === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(record.projectId.trim())) {
		return record.projectId.trim();
	}
	if (typeof record.lastDeploymentCommand === 'string') {
		const match = record.lastDeploymentCommand.match(/--project\s+([0-9a-f]{8}-[0-9a-f-]{27,})/iu);
		if (match?.[1]) {
			return match[1];
		}
	}
	for (const entry of Object.values(record)) {
		const found = findRailwayProjectId(entry);
		if (found) {
			return found;
		}
	}
	return null;
}

function railwayProjectIdFromDeployState(cwd: string, scope: TreeseedEnvironmentScope) {
	const stateScope = scope === 'prod' ? 'prod' : scope;
	const statePath = join(cwd, '.treeseed', 'state', 'environments', stateScope, 'deploy.json');
	if (!existsSync(statePath)) {
		return null;
	}
	try {
		return findRailwayProjectId(JSON.parse(readFileSync(statePath, 'utf8')));
	} catch {
		return null;
	}
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
		if (toolName === 'railway' && scope !== 'local' && targetArgs[0] !== 'link') {
			const environmentName = railwayEnvironmentName(scope);
			const projectId = managedEnv.TREESEED_RAILWAY_PROJECT_ID || railwayProjectIdFromDeployState(context.cwd, scope);
			if (projectId) {
				context.spawn(resolved.command, [
					...resolved.argsPrefix,
					'link',
					'--project',
					projectId,
					'--environment',
					environmentName,
					'--json',
				], {
					cwd: context.cwd,
					env: managedEnv,
					stdio: 'pipe',
				});
			}
			const environmentResult = context.spawn(resolved.command, [
				...resolved.argsPrefix,
				'environment',
				environmentName,
				'--json',
			], {
				cwd: context.cwd,
				env: managedEnv,
				stdio: 'pipe',
			});
			if ((environmentResult.status ?? 1) !== 0) {
				return {
					exitCode: environmentResult.status ?? 1,
					stderr: [`Failed to select Railway environment ${railwayEnvironmentName(scope)} before running ${targetArgs.join(' ') || 'railway'}.`],
					report: {
						command: toolName,
						ok: false,
						scope,
						executable: resolved.command,
						binaryPath: resolved.binaryPath,
						argsPrefix: resolved.argsPrefix,
						args: targetArgs,
						environmentSelection: {
							environment: environmentName,
							status: environmentResult.status ?? 1,
						},
					},
				};
			}
		}
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
