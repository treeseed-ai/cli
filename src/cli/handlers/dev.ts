import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { ensureLocalWorkspaceLinks, findNearestTreeseedWorkspaceRoot, resolveTreeseedLaunchEnvironment } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { workflowErrorResult } from './workflow.js';

const require = createRequire(import.meta.url);

function resolveCoreDevEntrypoint(cwd: string) {
	const workspacePackageJsonPath = resolve(cwd, 'packages', 'core', 'package.json');
	const installedPackageJsonPath = resolve(cwd, 'node_modules', '@treeseed', 'core', 'package.json');
	let packageJsonPath = workspacePackageJsonPath;
	if (!existsSync(packageJsonPath)) {
		packageJsonPath = installedPackageJsonPath;
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
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
		exports?: Record<string, string | { default?: string }>;
	};
	const exportedScript = packageJson.exports?.['./scripts/dev-platform'];
	const distRelativePath = typeof exportedScript === 'string'
		? exportedScript
		: exportedScript?.default ?? './dist/scripts/dev-platform.js';
	const sourceEntrypoint = resolve(packageRoot, 'scripts', 'dev-platform.ts');
	const sourceRunner = resolve(packageRoot, 'scripts', 'run-ts.mjs');

	if (existsSync(sourceEntrypoint) && existsSync(sourceRunner)) {
		return {
			command: process.execPath,
			args: [sourceRunner, sourceEntrypoint],
		};
	}

	return {
		command: process.execPath,
		args: [resolve(packageRoot, distRelativePath)],
	};
}

export const handleDev: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const watch = invocation.commandName === 'dev:watch' || invocation.args.watch === true;
		const workspaceRoot = findNearestTreeseedWorkspaceRoot(context.cwd);
		const workspaceLinksMode = typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined;
		const workspaceLinks = workspaceRoot
			? ensureLocalWorkspaceLinks(workspaceRoot, { env: context.env, mode: workspaceLinksMode })
			: null;
		if (workspaceLinks?.created.length) {
			context.write(`[workspace][link] Linked ${workspaceLinks.created.length} local workspace package paths.`, 'stdout');
		}
		const resolved = resolveCoreDevEntrypoint(context.cwd);
		const args = watch ? [...resolved.args, '--watch'] : resolved.args;
		const result = context.spawn(resolved.command, args, {
			cwd: context.cwd,
			env: resolveTreeseedLaunchEnvironment({
				tenantRoot: context.cwd,
				scope: 'local',
				baseEnv: { ...process.env, ...(context.env ?? {}) },
			}),
			stdio: 'inherit',
		});
		return {
			exitCode: result.status ?? 1,
			report: {
				command: 'dev',
				ok: (result.status ?? 1) === 0,
				watch,
				executable: resolved.command,
				args,
				workspaceLinks,
			},
		};
	} catch (error) {
		return workflowErrorResult(error);
	}
};
