#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTreeseedEnvironmentToProcess } from './config-runtime-lib.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH, mergeStagingIntoMain, prepareReleaseBranches, pushBranch } from './git-workflow-lib.ts';
import { incrementVersion, planWorkspaceReleaseBump, applyWorkspaceVersionChanges, repoRoot } from './workspace-save-lib.ts';
import { run, workspaceRoot } from './workspace-tools.ts';
import { runWorkspaceSavePreflight } from './save-deploy-preflight-lib.ts';

function parseArgs(argv) {
	const flags = new Set(argv);
	const selected = ['major', 'minor', 'patch'].filter((level) => flags.has(`--${level}`));
	if (selected.length !== 1) {
		throw new Error('Treeseed release requires exactly one version bump flag: --major, --minor, or --patch.');
	}
	return { level: selected[0] };
}

function bumpRootPackageJson(root, level) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.version = incrementVersion(packageJson.version, level);
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	return packageJson.version;
}

const { level } = parseArgs(process.argv.slice(2));
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

console.log('Treeseed release completed successfully.');
console.log(`Staging branch: ${STAGING_BRANCH}`);
console.log(`Production branch: ${PRODUCTION_BRANCH}`);
console.log(`Release level: ${level}`);
console.log(`Root version: ${rootVersion}`);
