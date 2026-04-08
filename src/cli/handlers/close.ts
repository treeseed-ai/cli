import type { TreeseedCommandHandler } from '../types.js';
import { applyTreeseedEnvironmentToProcess } from '../../../scripts/config-runtime-lib.ts';
import {
	cleanupDestroyedState,
	createBranchPreviewDeployTarget,
	destroyCloudflareResources,
	loadDeployState,
	printDestroySummary,
	validateDestroyPrerequisites,
} from '../../../scripts/deploy-lib.ts';
import {
	assertFeatureBranch,
	deleteLocalBranch,
	deleteRemoteBranch,
	mergeCurrentBranchIntoStaging,
} from '../../../scripts/git-workflow-lib.ts';
import { loadCliDeployConfig } from '../../../scripts/package-tools.ts';
import { runWorkspaceSavePreflight } from '../../../scripts/save-deploy-preflight-lib.ts';
import { guidedResult } from './utils.js';

export const handleClose: TreeseedCommandHandler = (_invocation, context) => {
	const commandName = _invocation.commandName || 'close';
	const tenantRoot = context.cwd;
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

	return {
		...guidedResult({
			command: commandName,
			summary: `Treeseed ${commandName} completed successfully.`,
			facts: [
				{ label: 'Merged branch', value: featureBranch },
				{ label: 'Merge target', value: 'staging' },
				{ label: 'Preview cleanup', value: previewState.readiness?.initialized ? 'performed' : 'not needed' },
			],
			nextSteps: [
				'treeseed deploy --environment staging',
				'treeseed release --patch',
			],
			report: {
				branchName: featureBranch,
				mergeTarget: 'staging',
				previewCleanup: previewState.readiness?.initialized === true,
			},
		}),
	};
};
