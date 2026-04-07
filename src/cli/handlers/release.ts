import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TreeseedCommandHandler } from '../types.js';
import { applyTreeseedEnvironmentToProcess } from '../../../scripts/config-runtime-lib.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH, mergeStagingIntoMain, prepareReleaseBranches, pushBranch } from '../../../scripts/git-workflow-lib.ts';
import { applyWorkspaceVersionChanges, incrementVersion, planWorkspaceReleaseBump, repoRoot } from '../../../scripts/workspace-save-lib.ts';
import { run, workspaceRoot } from '../../../scripts/workspace-tools.ts';
import { runWorkspaceSavePreflight } from '../../../scripts/save-deploy-preflight-lib.ts';
import { guidedResult } from './utils.js';

function bumpRootPackageJson(root: string, level: string) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.version = incrementVersion(packageJson.version, level);
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	return packageJson.version;
}

export const handleRelease: TreeseedCommandHandler = (invocation, context) => {
	const commandName = invocation.commandName || 'release';
	const level = ['major', 'minor', 'patch'].find((candidate) => invocation.args[candidate] === true);
	const root = workspaceRoot();
	const gitRoot = repoRoot(root);

	prepareReleaseBranches(root);
	applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope: 'staging' });
	runWorkspaceSavePreflight({ cwd: root });

	const plan = planWorkspaceReleaseBump(level, root);
	applyWorkspaceVersionChanges(plan);
	const rootVersion = bumpRootPackageJson(root, level);

	run('git', ['checkout', STAGING_BRANCH], { cwd: gitRoot });
	run('git', ['add', '-A'], { cwd: gitRoot });
	run('git', ['commit', '-m', `release: ${level} bump`], { cwd: gitRoot });
	pushBranch(gitRoot, STAGING_BRANCH);
	mergeStagingIntoMain(root);

	return {
		...guidedResult({
			command: commandName,
			summary: `Treeseed ${commandName} completed successfully.`,
			facts: [
				{ label: 'Staging branch', value: STAGING_BRANCH },
				{ label: 'Production branch', value: PRODUCTION_BRANCH },
				{ label: 'Release level', value: level ?? '(unknown)' },
				{ label: 'Root version', value: rootVersion },
				{ label: 'Updated packages', value: plan.touched.size },
			],
			nextSteps: [
				'Monitor CI for the production deployment triggered from main.',
				'treeseed status',
			],
			report: {
				level,
				rootVersion,
				stagingBranch: STAGING_BRANCH,
				productionBranch: PRODUCTION_BRANCH,
				touchedPackages: [...plan.touched],
			},
		}),
	};
};
