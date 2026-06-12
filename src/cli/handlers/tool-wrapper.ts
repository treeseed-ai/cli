import {
	createTreeseedManagedToolEnv,
	listRailwayProjects,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedToolCommand,
} from '@treeseed/sdk/workflow-support';
import { loadTreeseedDeployConfigFromPath } from '@treeseed/sdk/platform/deploy-config';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function findRailwayProjectIdFromCommand(value: unknown): string | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const found = findRailwayProjectIdFromCommand(entry);
			if (found) {
				return found;
			}
		}
		return null;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.lastDeploymentCommand === 'string') {
		const match = record.lastDeploymentCommand.match(/--project\s+([0-9a-f]{8}-[0-9a-f-]{27,})/iu);
		if (match?.[1]) {
			return match[1];
		}
	}
	for (const entry of Object.values(record)) {
		const found = findRailwayProjectIdFromCommand(entry);
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
		const state = JSON.parse(readFileSync(statePath, 'utf8'));
		return findRailwayProjectIdFromCommand(state) ?? findRailwayProjectId(state);
	} catch {
		return null;
	}
}

function railwayProjectNameFromManifest(cwd: string) {
	const candidates = [
		join(cwd, 'treeseed.site.yaml'),
		join(cwd, 'packages', 'api', 'treeseed.site.yaml'),
		join(cwd, '..', '..', 'treeseed.site.yaml'),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const config = loadTreeseedDeployConfigFromPath(candidate);
			const services = config.services ?? {};
			const apiName = services.api?.railway?.projectName;
			const runnerName = services.operationsRunner?.railway?.projectName;
			if (typeof apiName === 'string' && apiName.trim()) return apiName.trim();
			if (typeof runnerName === 'string' && runnerName.trim()) return runnerName.trim();
			if (config.hosting?.kind === 'treeseed_control_plane' && config.slug) return config.slug;
		} catch {
			// Ignore unrelated or malformed manifests; the wrapper can still use deploy state.
		}
	}
	return null;
}

async function resolveLiveRailwayProjectId({
	cwd,
	env,
	fallbackProjectId,
}: {
	cwd: string;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fallbackProjectId: string | null;
}) {
	const projectName = typeof env.TREESEED_RAILWAY_PROJECT_NAME === 'string' && env.TREESEED_RAILWAY_PROJECT_NAME.trim()
		? env.TREESEED_RAILWAY_PROJECT_NAME.trim()
		: railwayProjectNameFromManifest(cwd);
	if (!projectName) {
		return fallbackProjectId;
	}
	try {
		const projects = await listRailwayProjects({ env });
		const live = projects.find((project) => project.deletedAt === null && project.name === projectName);
		return live?.id ?? projectName;
	} catch {
		return projectName;
	}
}

function railwayCommandUsesProjectFiles(args: string[]) {
	const command = args[0] ?? '';
	return ['up', 'dev', 'develop', 'run', 'local', 'shell'].includes(command);
}

function railwayCommandNeedsProjectContext(args: string[]) {
	const command = args[0] ?? '';
	if (!command) return false;
	if (args.includes('--help') || args.includes('-h')) return false;
	return ![
		'account',
		'completion',
		'environment',
		'environments',
		'help',
		'init',
		'link',
		'login',
		'logout',
		'open',
		'project',
		'projects',
		'team',
		'teams',
		'whoami',
		'workspace',
		'workspaces',
	].includes(command);
}

export const handleToolWrapper: TreeseedCommandHandler = async (invocation, context) => {
	let isolatedRailwayCwd: string | null = null;
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
		if (toolName === 'railway' && scope !== 'local' && railwayCommandNeedsProjectContext(targetArgs)) {
			const environmentName = railwayEnvironmentName(scope);
			const projectId = await resolveLiveRailwayProjectId({
				cwd: context.cwd,
				env: managedEnv,
				fallbackProjectId: managedEnv.TREESEED_RAILWAY_PROJECT_ID || railwayProjectIdFromDeployState(context.cwd, scope),
			});
			const railwayCwd = railwayCommandUsesProjectFiles(targetArgs)
				? context.cwd
				: (isolatedRailwayCwd = mkdtempSync(join(tmpdir(), `treeseed-railway-${scope}-`)));
			const railwayEnv = isolatedRailwayCwd
				? {
					...managedEnv,
					HOME: isolatedRailwayCwd,
					XDG_CONFIG_HOME: join(isolatedRailwayCwd, '.config'),
				}
				: managedEnv;
			if (projectId) {
				const linkResult = context.spawn(resolved.command, [
					...resolved.argsPrefix,
					'link',
					'--project',
					projectId,
					'--environment',
					environmentName,
					'--json',
				], {
					cwd: railwayCwd,
					env: railwayEnv,
					stdio: 'pipe',
				});
				if ((linkResult.status ?? 1) !== 0) {
					return {
						exitCode: linkResult.status ?? 1,
						stderr: [`Failed to link Railway project ${projectId} for ${environmentName} before running ${targetArgs.join(' ') || 'railway'}.`],
						report: {
							command: toolName,
							ok: false,
							scope,
							executable: resolved.command,
							binaryPath: resolved.binaryPath,
							argsPrefix: resolved.argsPrefix,
							args: targetArgs,
							projectLink: {
								projectId,
								environment: environmentName,
								status: linkResult.status ?? 1,
							},
						},
					};
				}
			}
			if (!(isolatedRailwayCwd && projectId)) {
				const environmentResult = context.spawn(resolved.command, [
					...resolved.argsPrefix,
					'environment',
					environmentName,
					'--json',
				], {
					cwd: railwayCwd,
					env: railwayEnv,
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
		}
		const railwayTargetCwd = toolName === 'railway' && isolatedRailwayCwd ? isolatedRailwayCwd : context.cwd;
		const targetEnv = toolName === 'railway' && isolatedRailwayCwd
			? {
				...managedEnv,
				HOME: isolatedRailwayCwd,
				XDG_CONFIG_HOME: join(isolatedRailwayCwd, '.config'),
			}
			: managedEnv;
		const result = context.spawn(resolved.command, [...resolved.argsPrefix, ...targetArgs], {
			cwd: railwayTargetCwd,
			env: targetEnv,
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
	} finally {
		if (isolatedRailwayCwd) {
			try {
				rmSync(isolatedRailwayCwd, { recursive: true, force: true });
			} catch {
				// Best-effort cleanup for an operator convenience wrapper.
			}
		}
	}
};
