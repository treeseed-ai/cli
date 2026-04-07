import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { TreeseedCommandHandler } from '../types.js';
import { applyTreeseedEnvironmentToProcess } from '../../../scripts/config-runtime-lib.ts';
import {
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
} from '../../../scripts/deploy-lib.ts';
import { packageScriptPath, wranglerBin } from '../../../scripts/package-tools.ts';
import { run } from '../../../scripts/workspace-tools.ts';
import { repoRoot } from '../../../scripts/workspace-save-lib.ts';
import { guidedResult } from './utils.js';
import { copyTreeseedOperationalState } from '../repair.js';
import { loadTreeseedDeployConfig } from '@treeseed/core/deploy/config';

function selectRollbackCommit(state: Record<string, unknown>, requested: string | null) {
	const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory as Array<Record<string, unknown>> : [];
	if (requested) return requested;
	const latestCommit = typeof state.lastDeployedCommit === 'string' ? state.lastDeployedCommit : null;
	const previous = [...history].reverse().find((entry) => typeof entry.commit === 'string' && entry.commit !== latestCommit);
	return typeof previous?.commit === 'string' ? previous.commit : latestCommit;
}

function selectRollbackEntry(state: Record<string, unknown>, requested: string | null) {
	const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory as Array<Record<string, unknown>> : [];
	if (requested) {
		return history.find((entry) => entry.commit === requested) ?? null;
	}
	const latestCommit = typeof state.lastDeployedCommit === 'string' ? state.lastDeployedCommit : null;
	return [...history].reverse().find((entry) => typeof entry.commit === 'string' && entry.commit !== latestCommit) ?? null;
}

function isRollbackCompatible(state: Record<string, unknown>, candidate: Record<string, unknown> | null) {
	if (!candidate) {
		return { ok: true, reason: null };
	}
	const current = state.runtimeCompatibility as Record<string, unknown> | undefined;
	const currentGeneration = typeof current?.envelopeSchemaGeneration === 'string' ? current.envelopeSchemaGeneration : null;
	const currentWave = typeof current?.migrationWaveId === 'string' ? current.migrationWaveId : null;
	const candidateGeneration = typeof candidate.envelopeSchemaGeneration === 'string' ? candidate.envelopeSchemaGeneration : null;
	const candidateWave = typeof candidate.migrationWaveId === 'string' ? candidate.migrationWaveId : null;
	if (currentGeneration && candidateGeneration && currentGeneration !== candidateGeneration) {
		return { ok: false, reason: `Rollback target uses envelope generation ${candidateGeneration} but the current environment is on ${currentGeneration}.` };
	}
	if (currentWave && candidateWave && currentWave !== candidateWave) {
		return { ok: false, reason: `Rollback target was deployed before migration wave ${currentWave} and cannot be safely reused without a forward-compatible data bridge.` };
	}
	return { ok: true, reason: null };
}

function runGitWorktree(repoDir: string, args: string[]) {
	return run('git', ['worktree', ...args], { cwd: repoDir, capture: true });
}

export const handleRollback: TreeseedCommandHandler = (invocation, context) => {
	const scope = invocation.positionals[0];
	if (scope !== 'staging' && scope !== 'prod') {
		return guidedResult({
			command: 'rollback',
			summary: 'Treeseed rollback requires an explicit persistent target.',
			facts: [{ label: 'Provided target', value: scope ?? '(none)' }],
			nextSteps: ['treeseed rollback staging', 'treeseed rollback prod'],
			report: { scope: scope ?? null },
			exitCode: 1,
		});
	}

	const requestedCommit = typeof invocation.args.to === 'string' ? invocation.args.to : null;
	const tenantRoot = context.cwd;
	const deployConfig = loadTreeseedDeployConfig();
	const target = createPersistentDeployTarget(scope);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const rollbackEntry = selectRollbackEntry(state, requestedCommit);
	const rollbackCommit = selectRollbackCommit(state, requestedCommit);
	if (!rollbackCommit) {
		return guidedResult({
			command: 'rollback',
			summary: `No rollback candidate is recorded for ${scope}.`,
			facts: [{ label: 'Target', value: scope }],
			nextSteps: ['treeseed status'],
			report: { scope, rollbackCommit: null, deploymentHistory: state.deploymentHistory ?? [] },
			exitCode: 1,
		});
	}
	const compatibility = isRollbackCompatible(state as Record<string, unknown>, rollbackEntry);
	if (!compatibility.ok) {
		return guidedResult({
			command: 'rollback',
			summary: `Treeseed rollback refused for ${scope}.`,
			facts: [
				{ label: 'Target', value: scope },
				{ label: 'Requested commit', value: rollbackCommit },
				{ label: 'Reason', value: compatibility.reason ?? 'Unknown compatibility boundary' },
			],
			nextSteps: ['treeseed status', `treeseed publish --environment ${scope}`],
			report: { scope, rollbackCommit, compatibility, deploymentHistory: state.deploymentHistory ?? [] },
			exitCode: 1,
		});
	}

	const gitRoot = repoRoot(tenantRoot);
	const tenantRelativePath = relative(gitRoot, tenantRoot);
	const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-rollback-'));
	const tempTenantRoot = resolve(tempRoot, tenantRelativePath);
	const currentNodeModules = resolve(tenantRoot, 'node_modules');
	let finalizedState: Record<string, unknown> | null = null;

	try {
		runGitWorktree(gitRoot, ['add', '--detach', tempRoot, rollbackCommit]);
		copyTreeseedOperationalState(tenantRoot, tempTenantRoot);
		if (existsSync(currentNodeModules) && !existsSync(resolve(tempTenantRoot, 'node_modules'))) {
			symlinkSync(currentNodeModules, resolve(tempTenantRoot, 'node_modules'), 'dir');
		}

		applyTreeseedEnvironmentToProcess({ tenantRoot, scope });
		const { wranglerPath } = ensureGeneratedWranglerConfig(tempTenantRoot, { target });

		const buildResult = context.spawn(process.execPath, [packageScriptPath('tenant-build')], {
			cwd: tempTenantRoot,
			env: { ...context.env },
			stdio: 'inherit',
		});
		if ((buildResult.status ?? 1) !== 0) {
			return { exitCode: buildResult.status ?? 1 };
		}

		const publishResult = context.spawn(process.execPath, [wranglerBin, 'deploy', '--config', wranglerPath], {
			cwd: tempTenantRoot,
			env: { ...context.env },
			stdio: 'inherit',
		});
		if ((publishResult.status ?? 1) !== 0) {
			return { exitCode: publishResult.status ?? 1 };
		}

		const previousCommit = process.env.TREESEED_DEPLOY_COMMIT;
		process.env.TREESEED_DEPLOY_COMMIT = rollbackCommit;
		try {
			finalizedState = finalizeDeploymentState(tenantRoot, { target }) as unknown as Record<string, unknown>;
		} finally {
			if (previousCommit) {
				process.env.TREESEED_DEPLOY_COMMIT = previousCommit;
			} else {
				delete process.env.TREESEED_DEPLOY_COMMIT;
			}
		}
	} finally {
		try {
			runGitWorktree(gitRoot, ['remove', '--force', tempRoot]);
		} catch {
			// Best-effort cleanup for the temporary rollback worktree.
		}
	}

	return guidedResult({
		command: 'rollback',
		summary: `Treeseed rollback completed for ${scope}.`,
		facts: [
			{ label: 'Target', value: deployTargetLabel(target) },
			{ label: 'Rolled back commit', value: rollbackCommit },
			{ label: 'Deployed URL', value: finalizedState?.lastDeployedUrl as string | undefined },
		],
		nextSteps: ['treeseed status', `treeseed publish --environment ${scope}`],
		report: {
			scope,
			rollbackCommit,
			rollbackEntry,
			target: deployTargetLabel(target),
			finalizedState,
		},
	});
};
