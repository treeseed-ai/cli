import { run, workspaceRoot } from './workspace-tools.ts';
import { currentBranch, gitStatusPorcelain, repoRoot } from './workspace-save-lib.ts';

export const STAGING_BRANCH = 'staging';
export const PRODUCTION_BRANCH = 'main';

function runGit(args, { cwd, capture = false } = {}) {
	return run('git', args, { cwd, capture });
}

export function gitWorkflowRoot(cwd = workspaceRoot()) {
	return repoRoot(cwd);
}

export function assertCleanWorktree(cwd = workspaceRoot()) {
	const root = gitWorkflowRoot(cwd);
	if (gitStatusPorcelain(root).length > 0) {
		throw new Error('Treeseed requires a clean git worktree before changing branches.');
	}
	return root;
}

export function branchExists(repoDir, branchName) {
	try {
		runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoDir });
		return true;
	} catch {
		return false;
	}
}

export function remoteBranchExists(repoDir, branchName) {
	try {
		const output = runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: repoDir, capture: true });
		return output.trim().length > 0;
	} catch {
		return false;
	}
}

export function fetchOrigin(repoDir) {
	runGit(['fetch', 'origin'], { cwd: repoDir });
}

export function ensureLocalBranchTracking(repoDir, branchName) {
	if (branchExists(repoDir, branchName)) {
		return;
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
		return;
	}

	runGit(['checkout', '--orphan', branchName], { cwd: repoDir });
}

export function checkoutBranch(repoDir, branchName) {
	runGit(['checkout', branchName], { cwd: repoDir });
}

export function syncBranchWithOrigin(repoDir, branchName) {
	fetchOrigin(repoDir);
	if (!branchExists(repoDir, branchName) && remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
	} else {
		checkoutBranch(repoDir, branchName);
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['pull', '--rebase', 'origin', branchName], { cwd: repoDir });
	}
}

export function createFeatureBranchFromStaging(cwd, branchName) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);

	if (branchExists(repoDir, branchName) || remoteBranchExists(repoDir, branchName)) {
		throw new Error(`Branch "${branchName}" already exists locally or on origin.`);
	}

	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	runGit(['checkout', '-b', branchName], { cwd: repoDir });

	return {
		repoDir,
		baseBranch: STAGING_BRANCH,
		branchName,
	};
}

export function pushBranch(repoDir, branchName, { setUpstream = false } = {}) {
	const args = setUpstream ? ['push', '-u', 'origin', branchName] : ['push', 'origin', branchName];
	runGit(args, { cwd: repoDir });
}

export function deleteLocalBranch(repoDir, branchName) {
	if (!branchExists(repoDir, branchName)) {
		return;
	}
	runGit(['branch', '-D', branchName], { cwd: repoDir });
}

export function deleteRemoteBranch(repoDir, branchName) {
	if (!remoteBranchExists(repoDir, branchName)) {
		return false;
	}
	runGit(['push', 'origin', '--delete', branchName], { cwd: repoDir });
	return true;
}

export function mergeCurrentBranchIntoStaging(cwd, featureBranch) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	runGit(['merge', '--no-ff', featureBranch, '-m', `merge: ${featureBranch} -> ${STAGING_BRANCH}`], { cwd: repoDir });
	pushBranch(repoDir, STAGING_BRANCH);
	return repoDir;
}

export function currentManagedBranch(cwd = workspaceRoot()) {
	return currentBranch(gitWorkflowRoot(cwd));
}

export function assertFeatureBranch(cwd = workspaceRoot()) {
	const branchName = currentManagedBranch(cwd);
	if (!branchName) {
		throw new Error('Unable to determine the current git branch.');
	}
	if (branchName === STAGING_BRANCH || branchName === PRODUCTION_BRANCH) {
		throw new Error(`Treeseed close only works on feature branches. Current branch: ${branchName}`);
	}
	return branchName;
}

export function prepareReleaseBranches(cwd = workspaceRoot()) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	if (remoteBranchExists(repoDir, PRODUCTION_BRANCH) || branchExists(repoDir, PRODUCTION_BRANCH)) {
		syncBranchWithOrigin(repoDir, PRODUCTION_BRANCH);
		syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	}
	return repoDir;
}

export function mergeStagingIntoMain(cwd = workspaceRoot()) {
	const repoDir = prepareReleaseBranches(cwd);
	checkoutBranch(repoDir, PRODUCTION_BRANCH);
	if (remoteBranchExists(repoDir, PRODUCTION_BRANCH)) {
		runGit(['pull', '--rebase', 'origin', PRODUCTION_BRANCH], { cwd: repoDir });
	}
	runGit(['merge', '--no-ff', STAGING_BRANCH, '-m', `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`], { cwd: repoDir });
	pushBranch(repoDir, STAGING_BRANCH);
	pushBranch(repoDir, PRODUCTION_BRANCH);
	return repoDir;
}
