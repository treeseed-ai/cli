import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationChangeSetReceiptId,repositoryIdentityKey } from '@treeseed/sdk';
import { makeTenantWorkspace } from '../../../support/cli-test-fixtures.ts';
import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { runCommandLine } = await import('../../../../dist/cli/main.js');

async function runCli(args, cwd) {
	const writes = [];
	const exitCode = await runCommandLine(args, {
		cwd,
		env: { ...process.env, CI: undefined, GITHUB_ACTIONS: undefined },
		interactiveUi: false,
		write(output, stream) {
			writes.push({ output, stream });
		},
		spawn() {
			return { status: 0 };
		},
	});
	const output = writes.map((entry) => entry.output).join('\n');
	return { exitCode, output };
}

function parseJsonOutput(output) {
	const start = output.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${output}`);
	return JSON.parse(output.slice(start));
}

test('staging promotion plan fails closed without Platform root authority', async () => {
	const root = makeTenantWorkspace('staging');
	const origin = mkdtempSync(join(tmpdir(), 'treeseed-stage-origin-'));
	spawnSync('git', ['init', '--bare'], { cwd: origin, stdio: 'ignore' });
	spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['push', '-u', 'origin', 'staging'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['checkout', '-b', 'feature/stage-plan'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['push', '-u', 'origin', 'feature/stage-plan'], { cwd: root, stdio: 'ignore' });
	const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
	const receiptPath = join(root, '.treeseed', 'workflow', 'integration-receipts', 'latest.json');
	mkdirSync(join(root, '.treeseed', 'workflow', 'integration-receipts'), { recursive: true });
	const receipt = {
		schemaVersion: 1,
		kind: 'treeseed.integration-change-set/v1',
		scope: 'federated' as const,
		receiptId: '',
		runId: 'stage-plan-save',
		sourceBranch: 'feature/stage-plan',
		createdAt: new Date().toISOString(),
		repositories: [{
			name: '@treeseed/market',
			role: 'root',
			repository: { canonicalKey: repositoryIdentityKey(origin), remoteUrl: origin },
			workspacePath: '.',
			sourceBranch: 'feature/stage-plan',
			commit,
			dependencies: [],
			contractDigests: { packageManifest: null, lockfile: null },
			verification: { status: 'skipped', mode: null },
			executionAuthorities: [],
			remoteProof: { kind: 'branch_head', ref: 'feature/stage-plan', refCommit: commit },
			remoteVerified: true,
		}],
	};
	receipt.receiptId = integrationChangeSetReceiptId(receipt as never);
	writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

	const result = await runCli(['stage', '--plan', '--json', 'staging promotion plan'], root);

	assert.equal(result.exitCode, 1, result.output);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'stage');
	assert.equal(payload.ok, false);
	assert.equal(payload.summary, 'Treeseed stage plan blocked.');
	assert.equal(payload.payload.mode, 'stage-promotion');
	assert.equal(payload.payload.branchName, 'feature/stage-plan');
	assert.equal(payload.payload.mergeTarget, 'staging');
	assert.deepEqual(payload.payload.blockers, ['Platform root base and pointer-update authority is missing or stale.']);
	assert.equal(payload.hostingGraph, undefined);
	assert.equal(payload.desiredGraph, undefined);
	assert.equal(payload.payload.finalState, undefined);
	assert.equal(payload.payload.repos, undefined);
	assert.equal(payload.payload.readiness, undefined);
	assert.equal(payload.payload.units, undefined);
	assert.equal(payload.payload.plannedSteps, undefined);

});
