import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTenantWorkspace } from './cli-test-fixtures.mjs';

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

test('blocked stage plan json stays compact', async () => {
	const root = makeTenantWorkspace('staging');

	const result = await runCli(['stage', '--plan', '--json', 'blocked staging plan'], root);

	assert.equal(result.exitCode, 1);
	const payload = JSON.parse(result.output);
	assert.equal(payload.command, 'stage');
	assert.equal(payload.ok, false);
	assert.equal(payload.summary, 'Treeseed stage plan blocked.');
	assert.ok(payload.payload.blockers.includes('Stage only applies to task branches.'));
	assert.equal(payload.payload.branchName, 'staging');
	assert.equal(payload.hostingGraph, undefined);
	assert.equal(payload.payload.finalState, undefined);
	assert.equal(payload.payload.repos, undefined);
	assert.equal(payload.payload.readiness, undefined);
});
