import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveCapacityProviderLaunchEnvironment } from '@treeseed/sdk/capacity-provider';
import { resolveMarketProfile } from '@treeseed/sdk/market-client';
import { findNearestTreeseedRoot, findNearestTreeseedWorkspaceRoot } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandContext, TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { fail, guidedResult } from './utils.js';

const ENTRYPOINT_RELATIVE_PATH = ['dist', 'provider', 'entrypoint.js'] as const;
const COMPOSE_FILE_NAME = 'compose.capacity-provider.yml';
const DEFAULT_PROJECT_NAME = 'treeseed-capacity-provider';
const DEFAULT_HOST_DATA_DIR = '.treeseed/local-capacity-provider/data';
const PROVIDER_LIFECYCLE_ACTIONS = new Set(['build', 'up', 'down', 'restart', 'logs', 'status', 'test-local']);
const PROVIDER_ENTRYPOINT_ACTIONS = new Set(['doctor', 'register', 'plan']);

type AgentPackageResolution = {
	packageRoot: string;
	entrypointPath: string;
	composeFilePath: string;
};

function stringArg(invocation: TreeseedParsedInvocation, name: string) {
	const value = invocation.args[name];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, name: string) {
	return invocation.args[name] === true;
}

function readPackageName(packageRoot: string) {
	const packageJsonPath = resolve(packageRoot, 'package.json');
	if (!existsSync(packageJsonPath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
		return parsed.name ?? null;
	} catch {
		return null;
	}
}

function agentEntrypoint(packageRoot: string) {
	return resolve(packageRoot, ...ENTRYPOINT_RELATIVE_PATH);
}

function resolveAgentPackageRoot(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext): string | null {
	const explicitRoot = stringArg(invocation, 'agentPackageRoot');
	if (explicitRoot) {
		return resolve(context.cwd, explicitRoot);
	}
	if (readPackageName(context.cwd) === '@treeseed/agent') {
		return context.cwd;
	}
	const workspaceRoot = findNearestTreeseedWorkspaceRoot(context.cwd);
	const workspaceAgentRoot = workspaceRoot ? resolve(workspaceRoot, 'packages', 'agent') : null;
	if (workspaceAgentRoot && existsSync(resolve(workspaceAgentRoot, 'package.json'))) {
		return workspaceAgentRoot;
	}
	const nearestProjectRoot = findNearestTreeseedRoot(context.cwd);
	const projectAgentRoot = nearestProjectRoot ? resolve(nearestProjectRoot, 'packages', 'agent') : null;
	if (projectAgentRoot && existsSync(resolve(projectAgentRoot, 'package.json'))) {
		return projectAgentRoot;
	}
	const installedRoot = resolve(context.cwd, 'node_modules', '@treeseed', 'agent');
	if (existsSync(resolve(installedRoot, 'package.json'))) {
		return installedRoot;
	}
	return null;
}

function resolveAgentPackage(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext, options: { requireEntrypoint?: boolean } = {}): AgentPackageResolution {
	const packageRoot = resolveAgentPackageRoot(invocation, context);
	if (!packageRoot) {
		throw new Error(
			'Unable to locate @treeseed/agent. Build the workspace package, install @treeseed/agent, or pass --agent-package-root.',
		);
	}
	const entrypointPath = agentEntrypoint(packageRoot);
	if (options.requireEntrypoint !== false && !existsSync(entrypointPath)) {
		throw new Error(
			`Missing provider runtime at ${entrypointPath}. Run npm -w packages/agent run build:dist or pass --agent-package-root to a built package.`,
		);
	}
	const composeFilePath = resolve(packageRoot, COMPOSE_FILE_NAME);
	return { packageRoot, entrypointPath, composeFilePath };
}

function providerSelector(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'provider') ?? 'local';
}

function environmentSelector(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'environment') ?? 'local';
}

function resolveMarket(invocation: TreeseedParsedInvocation) {
	return resolveMarketProfile(stringArg(invocation, 'market') ?? 'local');
}

function resolveTenantRoot(context: TreeseedCommandContext, agentPackageRoot: string) {
	return findNearestTreeseedRoot(context.cwd) ?? (readPackageName(agentPackageRoot) === '@treeseed/agent' ? agentPackageRoot : context.cwd);
}

function defaultHostDataDir(context: TreeseedCommandContext) {
	const tenantRoot = findNearestTreeseedRoot(context.cwd) ?? context.cwd;
	return resolve(tenantRoot, DEFAULT_HOST_DATA_DIR);
}

function providerProjectName(invocation: TreeseedParsedInvocation) {
	const provider = providerSelector(invocation).replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'local';
	return `${DEFAULT_PROJECT_NAME}-${provider}`;
}

function composeCommandArgs(composeFilePath: string, projectName: string, action: string) {
	const base = ['compose', '-f', composeFilePath, '-p', projectName];
	switch (action) {
		case 'up':
			return [...base, 'up', '-d'];
		case 'down':
			return [...base, 'down'];
		case 'restart':
			return [...base, 'restart'];
		case 'logs':
			return [...base, 'logs', '--tail', '200'];
		case 'status':
			return [...base, 'ps'];
		default:
			return base;
	}
}

function lifecycleActionRequiresConnection(action: string) {
	return action === 'up' || action === 'restart';
}

function runLifecycleAction(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const agentPackage = resolveAgentPackage(invocation, context, { requireEntrypoint: action !== 'build' });
	if (action !== 'build' && action !== 'test-local' && !existsSync(agentPackage.composeFilePath)) {
		return fail(`Missing ${COMPOSE_FILE_NAME} in ${agentPackage.packageRoot}. Build or reinstall @treeseed/agent with Phase 3 container assets.`);
	}
	if (action === 'build' || action === 'test-local') {
		const script = action === 'build' ? 'capacity-provider:build' : 'capacity-provider:test-local';
		const result = context.spawn('npm', ['run', script], {
			cwd: agentPackage.packageRoot,
			env: context.env,
			stdio: 'inherit',
		});
		return guidedResult({
			command: `capacity ${action}`,
			summary: result.status === 0
				? `Capacity provider ${action === 'build' ? 'image build' : 'container smoke test'} completed.`
				: `Capacity provider ${action === 'build' ? 'image build' : 'container smoke test'} failed.`,
			facts: [
				{ label: 'Agent package', value: agentPackage.packageRoot },
				{ label: 'Script', value: script },
				{ label: 'Exit code', value: result.status ?? 1 },
			],
			exitCode: result.status ?? 1,
			report: {
				action,
				agentPackageRoot: agentPackage.packageRoot,
				script,
			},
		});
	}
	const diagnostic = boolArg(invocation, 'diagnostic') || action === 'test-local';
	const market = resolveMarket(invocation);
	const hostDataDirInput = stringArg(invocation, 'dataDir') ?? context.env.TREESEED_PROVIDER_HOST_DATA_DIR ?? defaultHostDataDir(context);
	const resolvedHostDataDir = resolve(context.cwd, hostDataDirInput);
	const tenantRoot = resolveTenantRoot(context, agentPackage.packageRoot);
	const launch = resolveCapacityProviderLaunchEnvironment({
		tenantRoot,
		scope: environmentSelector(invocation),
		env: context.env,
		diagnostic,
		requireConnection: lifecycleActionRequiresConnection(action),
		overrides: {
			TREESEED_MARKET_URL: market.baseUrl,
			TREESEED_MARKET_ID: market.id,
			TREESEED_PROVIDER_HOST_DATA_DIR: resolvedHostDataDir,
			TREESEED_PROVIDER_ENVIRONMENT: providerSelector(invocation),
			...(diagnostic ? { TREESEED_PROVIDER_STARTUP_MODE: 'diagnostic' } : {}),
		},
	});
	const hostDataDir = resolvedHostDataDir;
	mkdirSync(hostDataDir, { recursive: true });
	const projectName = providerProjectName(invocation);
	const args = composeCommandArgs(agentPackage.composeFilePath, projectName, action);
	const result = context.spawn('docker', args, {
		cwd: agentPackage.packageRoot,
		env: {
			...context.env,
			...launch.env,
		},
		stdio: 'inherit',
	});
	return guidedResult({
		command: `capacity ${action}`,
		summary: result.status === 0
			? `Capacity provider ${action} completed${diagnostic ? ' in diagnostic mode' : ''}.`
			: `Capacity provider ${action} failed.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Mode', value: diagnostic ? 'diagnostic' : 'live' },
			{ label: 'Compose project', value: projectName },
			{ label: 'Agent package', value: agentPackage.packageRoot },
			{ label: 'Data directory', value: hostDataDir },
			{ label: 'Exit code', value: result.status ?? 1 },
		],
		sections: [
			{
				title: 'Environment',
				lines: Object.entries(launch.redactedEnv)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, value]) => `${key}=${value}`),
			},
		],
		exitCode: result.status ?? 1,
		report: {
			action,
			agentPackageRoot: agentPackage.packageRoot,
			composeFile: agentPackage.composeFilePath,
			composeProject: projectName,
			market: { id: market.id, baseUrl: market.baseUrl },
			provider: providerSelector(invocation),
			diagnostic,
			redactedEnv: launch.redactedEnv,
		},
	});
}

function invokeProviderEntrypoint(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const agentPackage = resolveAgentPackage(invocation, context);
	const market = resolveMarket(invocation);
	const args = [agentPackage.entrypointPath, action, '--market', market.id, '--provider', providerSelector(invocation)];
	if (boolArg(invocation, 'dryRun') || action === 'doctor' || action === 'plan') {
		args.push('--dry-run');
	}
	if (context.outputFormat === 'json' || boolArg(invocation, 'json')) {
		args.push('--json');
	}
	const result = spawnSync(process.execPath, args, {
		cwd: agentPackage.packageRoot,
		env: {
			...context.env,
			TREESEED_MARKET_URL: market.baseUrl,
			TREESEED_MARKET_ID: market.id,
			TREESEED_PROVIDER_ENVIRONMENT: providerSelector(invocation),
		},
		encoding: 'utf8',
	});
	const stdout = result.stdout.trim();
	const stderr = result.stderr.trim();
	let report: Record<string, unknown> | null = null;
	if (stdout.startsWith('{')) {
		try {
			report = JSON.parse(stdout) as Record<string, unknown>;
		} catch {
			report = null;
		}
	}
	if (context.outputFormat === 'json') {
		return {
			exitCode: result.status ?? 1,
			stdout: stdout ? [stdout] : [],
			stderr: stderr ? [stderr] : [],
			report: report ?? {
				ok: result.status === 0,
				action,
				stdout,
				stderr,
				agentPackageRoot: agentPackage.packageRoot,
			},
		};
	}
	return guidedResult({
		command: `capacity ${action}`,
		summary: result.status === 0 ? `Capacity provider ${action} completed.` : `Capacity provider ${action} failed.`,
		facts: [
			{ label: 'Market', value: `${market.id} (${market.baseUrl})` },
			{ label: 'Provider', value: providerSelector(invocation) },
			{ label: 'Agent package', value: agentPackage.packageRoot },
			{ label: 'Exit code', value: result.status ?? 1 },
		],
		sections: [
			{ title: 'Output', lines: stdout ? stdout.split(/\r?\n/u) : [] },
			{ title: 'Errors', lines: stderr ? stderr.split(/\r?\n/u) : [] },
		],
		exitCode: result.status ?? 1,
		report: report ?? {
			ok: result.status === 0,
			action,
			agentPackageRoot: agentPackage.packageRoot,
		},
	});
}

export const handleCapacity: TreeseedCommandHandler = (invocation, context) => {
	const action = invocation.positionals[0] ?? 'doctor';
	if (PROVIDER_LIFECYCLE_ACTIONS.has(action)) {
		try {
			return runLifecycleAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (PROVIDER_ENTRYPOINT_ACTIONS.has(action)) {
		try {
			return invokeProviderEntrypoint(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	return fail(`Unknown capacity action "${action}". Use doctor, register, plan, build, up, down, restart, logs, status, or test-local.`);
};
