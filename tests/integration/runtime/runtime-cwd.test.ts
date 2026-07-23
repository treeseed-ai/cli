import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeWorkspaceRoot } from '../../support/cli-test-fixtures.ts';

const { runTreeseedCli } = await import('../../../dist/cli/main.js');

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

test('project commands fail safe from invalid managed worktree directories', async () => {
	const root = makeWorkspaceRoot();
	const invalidWorktree = resolve(root, '.treeseed', 'worktrees', 'broken-task');
	mkdirSync(invalidWorktree, { recursive: true });

	const result = await runCli(['status', '--json'], invalidWorktree);

	assert.equal(result.exitCode, 1);
	const payload = JSON.parse(result.output);
	assert.equal(payload.ok, false);
	assert.match(payload.error, /No ancestor containing treeseed\.site\.yaml/u);
	assert.match(payload.error, /broken-task/u);
});
