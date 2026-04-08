#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from './config-runtime-lib.ts';
import {
	createBranchPreviewDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	printDeploySummary,
	provisionCloudflareResources,
	runRemoteD1Migrations,
	syncCloudflareSecrets,
	validateDeployPrerequisites,
} from './deploy-lib.ts';
import { createFeatureBranchFromStaging, pushBranch } from './git-workflow-lib.ts';
import { packageScriptPath, resolveWranglerBin } from './package-tools.ts';

function parseArgs(argv) {
	const parsed = {
		branchName: null,
		preview: false,
	};

	for (const current of argv) {
		if (current === '--preview') {
			parsed.preview = true;
			continue;
		}
		if (!parsed.branchName) {
			parsed.branchName = current;
			continue;
		}
		throw new Error(`Unknown start argument: ${current}`);
	}

	if (!parsed.branchName) {
		throw new Error('Usage: treeseed start <branch-name> [--preview]');
	}

	return parsed;
}

function runNodeScript(scriptPath, scriptArgs = [], cwd) {
	const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
		stdio: 'inherit',
		cwd,
		env: { ...process.env },
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function runWranglerDeploy(configPath, cwd) {
	const result = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', configPath], {
		stdio: 'inherit',
		cwd,
		env: { ...process.env },
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

const options = parseArgs(process.argv.slice(2));
const tenantRoot = process.cwd();
const result = createFeatureBranchFromStaging(tenantRoot, options.branchName);
pushBranch(result.repoDir, options.branchName, { setUpstream: true });

if (!options.preview) {
	console.log(`Created feature branch ${options.branchName} from staging.`);
	console.log('Preview mode is disabled. Use local development for this branch.');
	process.exit(0);
}

applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging' });
assertTreeseedCommandEnvironment({ tenantRoot, scope: 'staging', purpose: 'deploy' });
validateDeployPrerequisites(tenantRoot, { requireRemote: true });

const target = createBranchPreviewDeployTarget(options.branchName);
const summary = provisionCloudflareResources(tenantRoot, { target });
printDeploySummary(summary);
const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
syncCloudflareSecrets(tenantRoot, { target });
runRemoteD1Migrations(tenantRoot, { target });
runNodeScript(packageScriptPath('tenant-build'), [], tenantRoot);
runWranglerDeploy(wranglerPath, tenantRoot);
const state = finalizeDeploymentState(tenantRoot, { target });

console.log(`Treeseed start preview completed for ${options.branchName}.`);
console.log(`Target: ${deployTargetLabel(target)}`);
console.log(`Preview URL: ${state.lastDeployedUrl}`);
