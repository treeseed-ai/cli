#!/usr/bin/env node

import { applyTreeseedEnvironmentToProcess } from './config-runtime-lib.ts';
import {
	cleanupDestroyedState,
	createBranchPreviewDeployTarget,
	destroyCloudflareResources,
	loadDeployState,
	printDestroySummary,
	validateDestroyPrerequisites,
} from './deploy-lib.ts';
import {
	assertFeatureBranch,
	deleteLocalBranch,
	deleteRemoteBranch,
	mergeCurrentBranchIntoStaging,
} from './git-workflow-lib.ts';
import { loadCliDeployConfig } from './package-tools.ts';
import { runWorkspaceSavePreflight } from './save-deploy-preflight-lib.ts';

const tenantRoot = process.cwd();
const featureBranch = assertFeatureBranch(tenantRoot);
const previewTarget = createBranchPreviewDeployTarget(featureBranch);
const deployConfig = loadCliDeployConfig(tenantRoot);
const previewState = loadDeployState(tenantRoot, deployConfig, { target: previewTarget });

runWorkspaceSavePreflight({ cwd: tenantRoot });
const repoDir = mergeCurrentBranchIntoStaging(tenantRoot, featureBranch);

if (previewState.readiness?.initialized) {
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging' });
	validateDestroyPrerequisites(tenantRoot, { requireRemote: true });
	const result = destroyCloudflareResources(tenantRoot, { target: previewTarget });
	printDestroySummary(result);
}

cleanupDestroyedState(tenantRoot, { target: previewTarget });
deleteRemoteBranch(repoDir, featureBranch);
deleteLocalBranch(repoDir, featureBranch);

console.log('Treeseed close completed successfully.');
console.log(`Merged ${featureBranch} into staging and removed branch artifacts.`);
