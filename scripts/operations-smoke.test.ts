import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspaceRoot } from './cli-test-fixtures.ts';

const { runTreeseedCli } = await import('../dist/cli/main.js');

async function runCli(args, cwd) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
		cwd,
		env: {
			...process.env,
			TREESEED_ACCEPTANCE_SERVICE_SECRET: '',
			TREESEED_API_WEB_SERVICE_SECRET: '',
			TREESEED_WEB_SERVICE_SECRET: '',
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

test('operations smoke emits redacted JSON failure without service secret', async () => {
	const result = await runCli(['operations', 'smoke', '--environment', 'staging', '--service', 'operationsRunner', '--json'], makeWorkspaceRoot());
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.ok, false);
	assert.match(payload.issues.join(' '), /Missing API service credential/u);
	assert.doesNotMatch(JSON.stringify(payload), /TREESEED_WEB_SERVICE_SECRET|secret-value/u);
});
