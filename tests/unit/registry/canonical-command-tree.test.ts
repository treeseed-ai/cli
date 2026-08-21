import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TREESEED_COMMAND_TREE_V1, listCommandPaths } from '@treeseed/sdk/operator-contracts';
import { findCommandSpec, listCommandNames } from '../../../src/cli/support/registry.ts';
import { runCommandLine } from '../../../src/cli/runtime/runtime.ts';

function capture() {
	const lines: string[] = [];
	return { lines, write: (value: string) => lines.push(value), spawn: () => ({ status: 0 }) };
}

test('the public registry exactly implements the accepted SDK command tree', () => {
	assert.deepEqual(listCommandNames(), listCommandPaths(TREESEED_COMMAND_TREE_V1));
	for (const name of listCommandNames()) {
		assert.equal(name.includes(':'), false, name);
		assert.equal(name.split(' ').some((segment) => segment.includes('-')), false, name);
		assert.equal('aliases' in (findCommandSpec(name) ?? {}), false, name);
	}
});

test('trsd is the only installed executable', () => {
	const packageDocument = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
	assert.deepEqual(packageDocument.bin, { trsd: './dist/cli/main.js' });
});

test('intermediate command nodes render generated help', async () => {
	const output = capture();
	assert.equal(await runCommandLine(['agents', 'classes'], { ...output, cwd: process.cwd(), env: process.env, interactiveUi: false }), 0);
	assert.match(output.lines.join('\n'), /agents classes list/u);
	assert.match(output.lines.join('\n'), /agents classes show/u);
});

test('removed flat, colon, alias, delegated, and integration commands are unknown and do not spawn', async () => {
	for (const command of ['capacity-plan-create', 'auth:login', 'cleanup', 'agents-runtime', 'checkpoint-integrate', 'content-integrate', 'content-abandon']) {
		let spawned = false;
		const output = capture();
		const exitCode = await runCommandLine([command, '--execute', '--json'], {
			...output, cwd: process.cwd(), env: process.env, interactiveUi: false,
			spawn: () => { spawned = true; return { status: 0 }; },
		});
		assert.equal(exitCode, 1, command);
		assert.equal(spawned, false, command);
		const envelope = JSON.parse(output.lines.join('\n'));
		assert.equal(envelope.schemaVersion, 'treeseed.command-result/v1');
		assert.equal(envelope.error.category, 'unknown_command');
	}
});

test('mutation leaves expose plan but never execute', () => {
	for (const name of listCommandNames()) {
		const spec = findCommandSpec(name)!;
		assert.equal((spec.options ?? []).some((option) => option.flags.startsWith('--execute')), false, name);
	}
	for (const name of ['workdays start', 'assignments retry', 'providers requests approve', 'release']) {
		assert.ok(findCommandSpec(name)?.options?.some((option) => option.name === 'plan'), name);
	}
});
