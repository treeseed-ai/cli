import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTenantWorkspace } from './cli-test-fixtures.ts';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { runTreeseedCli } = await import('../dist/cli/main.js');

async function runCli(args, cwd) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
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

test('staging promotion plan json stays compact', async () => {
	const root = makeTenantWorkspace('staging');
	const origin = mkdtempSync(join(tmpdir(), 'treeseed-stage-origin-'));
	spawnSync('git', ['init', '--bare'], { cwd: origin, stdio: 'ignore' });
	spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['push', '-u', 'origin', 'staging'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['checkout', '-b', 'feature/stage-plan'], { cwd: root, stdio: 'ignore' });
	spawnSync('git', ['push', '-u', 'origin', 'feature/stage-plan'], { cwd: root, stdio: 'ignore' });

	const result = await runCli(['stage', '--plan', '--json', 'staging promotion plan'], root);

	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'stage');
	assert.equal(payload.ok, true);
	assert.equal(payload.summary, 'Treeseed stage promotion plan ready.');
	assert.equal(payload.payload.mode, 'stage-promotion');
	assert.equal(payload.payload.branchName, 'feature/stage-plan');
	assert.equal(payload.payload.mergeTarget, 'staging');
	assert.equal(payload.payload.verifyMode, 'action');
	assert.equal(payload.payload.ciMode, 'off');
	assert.equal(payload.payload.cleanupMode, 'success');
	assert.ok(Array.isArray(payload.payload.phases));
	assert.equal(payload.payload.phases.includes('promote-to-staging'), true);
	assert.equal(payload.payload.plan.targetBranch, 'staging');
	assert.equal(payload.hostingGraph, undefined);
	assert.equal(payload.desiredGraph, undefined);
	assert.equal(payload.payload.finalState, undefined);
	assert.equal(payload.payload.repos, undefined);
	assert.equal(payload.payload.readiness, undefined);
	assert.equal(payload.payload.units, undefined);
	assert.equal(payload.payload.plannedSteps, undefined);
});
