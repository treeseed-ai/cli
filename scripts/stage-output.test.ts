import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTenantWorkspace } from './cli-test-fixtures.ts';

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

test('staging release-gate plan json stays compact', async () => {
	const root = makeTenantWorkspace('staging');

	const result = await runCli(['stage', '--plan', '--json', 'staging release-gate plan'], root);

	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'stage');
	assert.equal(payload.ok, true);
	assert.equal(payload.summary, 'Treeseed stage release-gate plan ready.');
	assert.equal(payload.payload.mode, 'reconcile-release-gates');
	assert.equal(payload.payload.branchName, 'staging');
	assert.equal(payload.payload.mergeTarget, 'staging');
	assert.ok(Array.isArray(payload.payload.units));
	assert.ok(Array.isArray(payload.payload.plannedSteps));
	assert.equal(payload.hostingGraph, undefined);
	assert.equal(payload.desiredGraph, undefined);
	assert.equal(payload.payload.finalState, undefined);
	assert.equal(payload.payload.repos, undefined);
	assert.equal(payload.payload.readiness, undefined);
});
