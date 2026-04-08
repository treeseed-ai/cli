import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTreeseedMachineConfigPaths } from '../../scripts/config-runtime-lib.ts';
import {
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
} from '../../scripts/deploy-lib.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../../scripts/git-workflow-lib.ts';
import { loadCliDeployConfig } from '../../scripts/package-tools.ts';
import { collectCliPreflight } from '../../scripts/workspace-preflight-lib.ts';
import { currentBranch, gitStatusPorcelain, repoRoot } from '../../scripts/workspace-save-lib.ts';
import { isWorkspaceRoot } from '../../scripts/workspace-tools.ts';

export type TreeseedBranchRole = 'feature' | 'staging' | 'main' | 'detached' | 'none';

export type TreeseedWorkflowRecommendation = {
	command: string;
	reason: string;
};

export type TreeseedWorkflowState = {
	cwd: string;
	workspaceRoot: boolean;
	tenantRoot: boolean;
	deployConfigPresent: boolean;
	repoRoot: string | null;
	branchName: string | null;
	branchRole: TreeseedBranchRole;
	environment: 'local' | 'staging' | 'prod' | 'none';
	dirtyWorktree: boolean;
	preview: {
		enabled: boolean;
		url: string | null;
		lastDeploymentTimestamp: string | null;
	};
	persistentEnvironments: Record<string, {
		initialized: boolean;
		lastValidatedAt: string | null;
		lastDeploymentTimestamp: string | null;
		lastDeployedUrl: string | null;
	}>;
	auth: {
		gh: boolean;
		wrangler: boolean;
		copilot: boolean;
	};
	files: {
		treeseedConfig: boolean;
		machineConfig: boolean;
		machineKey: boolean;
		envLocal: boolean;
		devVars: boolean;
	};
	releaseReady: boolean;
	rollbackCandidates: Array<{
		scope: 'staging' | 'prod';
		commit: string | null;
		timestamp: string | null;
		url: string | null;
	}>;
	recommendations: TreeseedWorkflowRecommendation[];
};

function safeResolveRepoRoot(cwd: string) {
	try {
		return repoRoot(cwd);
	} catch {
		return null;
	}
}

function branchRoleFor(branchName: string | null): TreeseedBranchRole {
	if (!branchName) return 'none';
	if (branchName === STAGING_BRANCH) return 'staging';
	if (branchName === PRODUCTION_BRANCH) return 'main';
	return 'feature';
}

function environmentForBranchRole(branchRole: TreeseedBranchRole): TreeseedWorkflowState['environment'] {
	if (branchRole === 'staging') return 'staging';
	if (branchRole === 'main') return 'prod';
	if (branchRole === 'feature') return 'local';
	return 'none';
}

function emptyPersistentEnvironments(): TreeseedWorkflowState['persistentEnvironments'] {
	return {
		local: { initialized: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
		staging: { initialized: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
		prod: { initialized: false, lastValidatedAt: null, lastDeploymentTimestamp: null, lastDeployedUrl: null },
	};
}

export function resolveTreeseedWorkflowState(cwd: string): TreeseedWorkflowState {
	const workspaceRoot = isWorkspaceRoot(cwd);
	const treeseedConfigPath = resolve(cwd, 'treeseed.site.yaml');
	const tenantRoot = existsSync(treeseedConfigPath);
	const root = safeResolveRepoRoot(cwd);
	const branchName = root ? currentBranch(root) || null : null;
	const branchRole = branchRoleFor(branchName);
	const dirtyWorktree = root ? gitStatusPorcelain(root).length > 0 : false;
	const preflight = collectCliPreflight({ cwd, requireAuth: false });
	const { configPath, keyPath } = getTreeseedMachineConfigPaths(cwd);
	const state: TreeseedWorkflowState = {
		cwd,
		workspaceRoot,
		tenantRoot,
		deployConfigPresent: tenantRoot,
		repoRoot: root,
		branchName,
		branchRole,
		environment: environmentForBranchRole(branchRole),
		dirtyWorktree,
		preview: {
			enabled: false,
			url: null,
			lastDeploymentTimestamp: null,
		},
		persistentEnvironments: emptyPersistentEnvironments(),
		auth: {
			gh: preflight.checks.auth.gh?.authenticated === true,
			wrangler: preflight.checks.auth.wrangler?.authenticated === true,
			copilot: preflight.checks.auth.copilot?.configured === true,
		},
		files: {
			treeseedConfig: tenantRoot,
			machineConfig: existsSync(configPath),
			machineKey: existsSync(keyPath),
			envLocal: existsSync(resolve(cwd, '.env.local')),
			devVars: existsSync(resolve(cwd, '.dev.vars')),
		},
		releaseReady: branchRole === 'staging' && !dirtyWorktree,
		rollbackCandidates: [],
		recommendations: [],
	};

	if (tenantRoot) {
		try {
			const deployConfig = loadCliDeployConfig(cwd);
			for (const scope of ['local', 'staging', 'prod'] as const) {
				const deployState = loadDeployState(cwd, deployConfig, { target: createPersistentDeployTarget(scope) });
				state.persistentEnvironments[scope] = {
					initialized: deployState.readiness?.initialized === true || scope === 'local',
					lastValidatedAt: deployState.readiness?.lastValidatedAt ?? deployState.readiness?.initializedAt ?? null,
					lastDeploymentTimestamp: deployState.lastDeploymentTimestamp ?? null,
					lastDeployedUrl: deployState.lastDeployedUrl ?? null,
				};
				if (scope !== 'local') {
					const history = Array.isArray((deployState as { deploymentHistory?: unknown[] }).deploymentHistory)
						? ((deployState as { deploymentHistory?: Array<Record<string, unknown>> }).deploymentHistory ?? [])
						: [];
					const latestHistory = history.at(-1) ?? null;
					state.rollbackCandidates.push({
						scope,
						commit: typeof latestHistory?.commit === 'string' ? latestHistory.commit : (deployState.lastDeployedCommit ?? null),
						timestamp: typeof latestHistory?.timestamp === 'string' ? latestHistory.timestamp : (deployState.lastDeploymentTimestamp ?? null),
						url: typeof latestHistory?.url === 'string' ? latestHistory.url : (deployState.lastDeployedUrl ?? null),
					});
				}
			}

			if (branchRole === 'feature' && branchName) {
				const previewState = loadDeployState(cwd, deployConfig, { target: createBranchPreviewDeployTarget(branchName) });
				state.preview = {
					enabled: previewState.previewEnabled === true || previewState.readiness?.initialized === true,
					url: previewState.lastDeployedUrl ?? null,
					lastDeploymentTimestamp: previewState.lastDeploymentTimestamp ?? null,
				};
			}
		} catch {
			// Leave deployment state unresolved when the tenant config cannot be loaded yet.
		}
	}

	state.recommendations = recommendTreeseedNextSteps(state);
	return state;
}

export function recommendTreeseedNextSteps(state: TreeseedWorkflowState): TreeseedWorkflowRecommendation[] {
	const recommendations: TreeseedWorkflowRecommendation[] = [];
	if (!state.workspaceRoot) {
		return [{ command: 'cd docs && treeseed doctor', reason: 'Switch to the Treeseed workspace root before using the guided workflow.' }];
	}
	if (!state.deployConfigPresent) {
		return [{ command: 'treeseed init <directory>', reason: 'Create a new Treeseed tenant before configuring or releasing anything.' }];
	}
	if (!state.files.machineConfig) {
		recommendations.push({ command: 'treeseed doctor', reason: 'Validate tooling, auth, and repository readiness first.' });
		recommendations.push({ command: 'treeseed setup', reason: 'Bootstrap the local machine config and local environment files.' });
		return recommendations;
	}
	if (state.branchRole === 'feature') {
		if (state.dirtyWorktree) {
			recommendations.push({ command: 'treeseed ship "describe your change"', reason: 'Persist and push the current feature branch before closing or releasing.' });
		} else {
			recommendations.push({ command: 'treeseed teardown', reason: 'Merge this feature branch into staging and clean up branch artifacts.' });
		}
		if (state.preview.enabled && state.branchName) {
			recommendations.push({ command: `treeseed publish --target-branch ${state.branchName}`, reason: 'Refresh the branch preview deployment when you need a live Cloudflare preview.' });
		} else {
			recommendations.push({ command: 'treeseed dev', reason: 'Use the local environment for iterative work on this feature branch.' });
		}
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'staging') {
		if (!state.persistentEnvironments.staging.initialized) {
			recommendations.push({ command: 'treeseed prepare --environment staging', reason: 'Initialize the staging environment before publishing or promoting.' });
		} else {
			recommendations.push({ command: 'treeseed publish --environment staging', reason: 'Publish the current staging branch to the initialized staging environment.' });
			recommendations.push({ command: 'treeseed promote --patch', reason: 'Promote staging into main when the integration branch is ready for production.' });
		}
		return recommendations.slice(0, 3);
	}
	if (state.branchRole === 'main') {
		if (state.dirtyWorktree) {
			recommendations.push({ command: 'treeseed ship --hotfix "describe the hotfix"', reason: 'Only explicit hotfix saves are allowed on main.' });
		} else if (!state.persistentEnvironments.prod.initialized) {
			recommendations.push({ command: 'treeseed prepare --environment prod', reason: 'Initialize production before attempting a manual production publish.' });
		} else {
			recommendations.push({ command: 'treeseed publish --environment prod', reason: 'Run a manual production publish only when you intentionally need to bypass CI.' });
			recommendations.push({ command: 'treeseed rollback prod', reason: 'Roll back production to the previous recorded deployment if needed.' });
		}
		return recommendations.slice(0, 3);
	}
	recommendations.push({ command: 'treeseed dev', reason: 'Start the local Treeseed development environment.' });
	recommendations.push({ command: 'treeseed work feature/my-change', reason: 'Create a feature branch from the latest staging commit.' });
	return recommendations.slice(0, 3);
}
