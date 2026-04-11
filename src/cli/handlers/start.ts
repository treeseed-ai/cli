import type { TreeseedCommandHandler } from '../types.js';
import {
	applyTreeseedEnvironmentToProcess,
	assertTreeseedCommandEnvironment,
} from '@treeseed/sdk/workflow-support';
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
} from '@treeseed/sdk/workflow-support';
import { createFeatureBranchFromStaging, pushBranch } from '@treeseed/sdk/workflow-support';
import { packageScriptPath, resolveWranglerBin } from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';

export function provisionBranchPreview(branchName: string, context: Parameters<TreeseedCommandHandler>[1], commandName = 'start') {
	const tenantRoot = context.cwd;
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });
	assertTreeseedCommandEnvironment({ tenantRoot, scope: 'staging', purpose: 'deploy' });
	validateDeployPrerequisites(tenantRoot, { requireRemote: true });

	const target = createBranchPreviewDeployTarget(branchName);
	const summary = provisionCloudflareResources(tenantRoot, { target });
	printDeploySummary(summary);
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	syncCloudflareSecrets(tenantRoot, { target });
	runRemoteD1Migrations(tenantRoot, { target });

	const buildResult = context.spawn(process.execPath, [packageScriptPath('tenant-build')], {
		cwd: tenantRoot,
		env: { ...context.env },
		stdio: 'inherit',
	});
	if ((buildResult.status ?? 1) !== 0) {
		return { exitCode: buildResult.status ?? 1 };
	}

	const deployResult = context.spawn(process.execPath, [resolveWranglerBin(), 'deploy', '--config', wranglerPath], {
		cwd: tenantRoot,
		env: { ...context.env },
		stdio: 'inherit',
	});
	if ((deployResult.status ?? 1) !== 0) {
		return { exitCode: deployResult.status ?? 1 };
	}

	const state = finalizeDeploymentState(tenantRoot, { target });
	return guidedResult({
		command: commandName,
		summary: `Treeseed ${commandName} preview completed for ${branchName}.`,
		facts: [
			{ label: 'Target', value: deployTargetLabel(target) },
			{ label: 'Preview URL', value: state.lastDeployedUrl },
		],
		nextSteps: [
			'treeseed save "describe your change"',
			`treeseed deploy --target-branch ${branchName}`,
		],
		report: {
			branchName,
			preview: true,
			target: deployTargetLabel(target),
			previewUrl: state.lastDeployedUrl,
		},
	});
}

export const handleStart: TreeseedCommandHandler = (invocation, context) => {
	const commandName = invocation.commandName || 'start';
	const branchName = invocation.positionals[0];
	const preview = invocation.args.preview === true;
	const tenantRoot = context.cwd;
	const result = createFeatureBranchFromStaging(tenantRoot, branchName);
	pushBranch(result.repoDir, branchName, { setUpstream: true });

	if (!preview) {
		return guidedResult({
			command: commandName,
			summary: `Created feature branch ${branchName} from staging.`,
			facts: [
				{ label: 'Branch', value: branchName },
				{ label: 'Preview', value: 'disabled' },
			],
			nextSteps: [
				'treeseed dev',
				'treeseed save "describe your change"',
			],
			report: {
				branchName,
				preview: false,
				baseBranch: result.baseBranch,
			},
		});
	}

	return provisionBranchPreview(branchName, context, commandName);
};
