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
		const managerMode = invocation.commandName === 'dev:manager';
		const feedback = typeof invocation.args.feedback === 'string' ? invocation.args.feedback : undefined;
		const watch = feedback !== 'off';
		const passthroughArgs: string[] = [];
		const forwardStringOption = (name: string, flag: string) => {
			const value = invocation.args[name];
			if (typeof value === 'string' && value.trim().length > 0) {
				passthroughArgs.push(flag, value);
			}
		};
		const forwardBooleanOption = (name: string, flag: string) => {
			if (invocation.args[name] === true) {
				passthroughArgs.push(flag);
			}
		};

		if (managerMode) {
			const explicitSurfaces = typeof invocation.args.surfaces === 'string' && invocation.args.surfaces.trim()
				? invocation.args.surfaces.trim()
				: typeof invocation.args.surface === 'string' && invocation.args.surface.trim()
					? invocation.args.surface.trim()
					: null;
			const surfaces = explicitSurfaces ?? (invocation.args.withWorker === true ? 'manager,worker' : 'manager');
			passthroughArgs.push('--surfaces', surfaces);
		} else {
			forwardStringOption('surface', '--surface');
			forwardStringOption('surfaces', '--surfaces');
		}
		forwardStringOption('host', '--host');
		forwardStringOption('port', '--port');
		forwardStringOption('apiHost', '--api-host');
		forwardStringOption('apiPort', '--api-port');
		forwardStringOption('managerPort', '--manager-port');
		forwardStringOption('setup', '--setup');
		forwardStringOption('feedback', '--feedback');
		forwardStringOption('open', '--open');
		forwardBooleanOption('plan', '--plan');
		forwardBooleanOption('reset', '--reset');
		forwardBooleanOption('json', '--json');
		const docsAutomationMode = typeof invocation.args.docsAutomation === 'string' ? invocation.args.docsAutomation.trim() : '';
		const workdayId = typeof invocation.args.workdayId === 'string' ? invocation.args.workdayId.trim() : '';
		const capacityBudget = typeof invocation.args.capacityBudget === 'string' ? invocation.args.capacityBudget.trim() : '';
		const approvalPolicy = typeof invocation.args.approvalPolicy === 'string' ? invocation.args.approvalPolicy.trim() : '';
		const devManagerEnv = managerMode
			? {
				TREESEED_DOCS_AUTOMATION_MODE: docsAutomationMode || 'on',
				...(workdayId ? { TREESEED_WORKDAY_ID: workdayId } : {}),
				...(capacityBudget ? {
					TREESEED_CAPACITY_BUDGET: capacityBudget,
					TREESEED_WORKDAY_TASK_CREDIT_BUDGET: capacityBudget,
				} : {}),
				TREESEED_APPROVAL_POLICY: approvalPolicy || 'manual',
			}
			: {};
		const workspaceRoot = findNearestTreeseedWorkspaceRoot(context.cwd);
		const workspaceLinksMode = typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined;
		const workspaceLinks = workspaceRoot
			? ensureLocalWorkspaceLinks(workspaceRoot, { env: context.env, mode: workspaceLinksMode })
			: null;
		if (workspaceLinks?.created.length && invocation.args.json !== true) {
			context.write(`[workspace][link] Linked ${workspaceLinks.created.length} local workspace package paths.`, 'stdout');
		}
		const resolved = resolveCoreDevEntrypoint(context.cwd);
		const args = watch ? [...resolved.args, ...passthroughArgs, '--watch'] : [...resolved.args, ...passthroughArgs];
		const result = context.spawn(resolved.command, args, {
			cwd: context.cwd,
			env: resolveTreeseedLaunchEnvironment({
				tenantRoot: context.cwd,
				scope: 'local',
				baseEnv: { ...process.env, ...(context.env ?? {}), ...devManagerEnv },
			}),
			stdio: 'inherit',
		});
		return {
			exitCode: result.status ?? 1,
			suppressJsonResult: invocation.args.json === true,
			report: {
				command: 'dev',
				alias: managerMode ? 'dev:manager' : invocation.commandName,
				ok: (result.status ?? 1) === 0,
				watch,
				executable: resolved.command,
				args,
				docsAutomation: managerMode ? {
					mode: docsAutomationMode || 'on',
					workdayId: workdayId || null,
					capacityBudget: capacityBudget || null,
					approvalPolicy: approvalPolicy || 'manual',
					withWorker: invocation.args.withWorker === true,
				} : undefined,
				workspaceLinks,
			},
		};
	} catch (error) {
		return workflowErrorResult(error);
	}
};
