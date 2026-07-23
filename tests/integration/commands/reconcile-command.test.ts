import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspaceRoot } from '../../support/cli-test-fixtures.ts';

const { runTreeseedCli } = await import('../../../dist/cli/main.js');

async function runCli(args, cwd, env = {}) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
		cwd,
		env: {
			...process.env,
			...env,
			NODE_ENV: 'test',
			CI: undefined,
			ACT: undefined,
			GITHUB_ACTIONS: undefined,
			TREESEED_VERIFY_DRIVER: undefined,
		},
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

test('reconcile live local provider reports canonical verified coverage', async () => {
	const result = await runCli(['reconcile', 'test-live', '--provider', 'local', '--environment', 'staging', '--json'], makeWorkspaceRoot());
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);

	assert.equal(payload.ok, true);
	assert.equal(payload.mode, 'smoke');
	assert.equal(payload.providers[0].provider, 'local');
	assert.equal(payload.providers[0].report.ok, true);
	assert.equal(payload.providers[0].report.blockedDrift.length, 0);
	assert.doesNotMatch(JSON.stringify(payload), /not implemented/iu);
});

test('reconcile acceptance requires explicit yes before mutating providers', async () => {
	const result = await runCli(['reconcile', 'test-live', '--mode', 'acceptance', '--provider', 'railway', '--environment', 'staging', '--json'], makeWorkspaceRoot());
	assert.equal(result.exitCode, 1);
	assert.match(result.output, /requires --yes|Re-run with --yes/u);
});

test('reconcile cleanup requires explicit yes before deleting providers', async () => {
	const result = await runCli(['reconcile', 'test-live', '--mode', 'cleanup', '--provider', 'railway', '--environment', 'staging', '--json'], makeWorkspaceRoot());
	assert.equal(result.exitCode, 1);
	assert.match(result.output, /requires --yes|Re-run with --yes/u);
});

test('reconcile live railway provider reports credential drift instead of unimplemented scenarios', async () => {
	const result = await runCli(['reconcile', 'test-live', '--provider', 'railway', '--environment', 'staging', '--json'], makeWorkspaceRoot(), {
		TREESEED_RAILWAY_API_TOKEN: '',
	});
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	const serialized = JSON.stringify(payload);

	assert.equal(payload.ok, false);
	assert.equal(payload.providers[0].provider, 'railway');
	assert.match(serialized, /Missing TREESEED_RAILWAY_API_TOKEN/u);
	assert.doesNotMatch(serialized, /declared but not implemented|not implemented in the canonical live-test harness/iu);
});
