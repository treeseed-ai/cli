import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { listCommandPaths, TREESEED_COMMAND_TREE_V1 } from '@treeseed/sdk/operator-contracts';
import { commandSpecs } from '../../../src/cli/registry.ts';
import { runCommandLine } from '../../../src/cli/runtime.ts';

test('registry exactly matches the SDK command tree', () => {
	assert.deepEqual(commandSpecs.map((command) => command.name), listCommandPaths(TREESEED_COMMAND_TREE_V1));
	assert.equal(commandSpecs.some((command) => command.name.includes(':')), false);
});

test('leaf commands expose only relevant high-level options', () => {
	const byName = new Map(commandSpecs.map((command) => [command.name, command.options.map((option) => option.flag)]));
	assert.deepEqual(byName.get('workdays start'), ['--market', '--team', '--preflight', '--digest', '--yes', '--json', '--plan']);
	assert.deepEqual(byName.get('plans show'), ['--market', '--team', '--json']);
	assert.deepEqual(byName.get('providers credentials revoke'), ['--market', '--team', '--credential', '--yes', '--json', '--plan']);
	assert.equal(commandSpecs.some((command) => command.options.some((option) => option.flag === '--execute')), false);
});

test('removed legacy commands are unknown without mutation', async () => {
	const output: string[] = [];
	for (const argv of [['capacity', 'capacity-plan-create'], ['agent-deploy'], ['content-integrate'], ['dev', 'start'], ['treedx', 'sync']]) {
		const exit = await runCommandLine([...argv, '--json'], { interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 1);
		assert.equal(JSON.parse(output.pop()!).error.category, 'unknown_command');
	}
});

test('mutations require confirmation and never invoke a legacy implementation', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['workdays', 'start', '--team', 'treeseed', '--preflight', 'p1', '--digest', 'sha256:x', '--json'], { interactiveUi: false, write: (value) => output.push(value) });
	assert.equal(exit, 1);
	assert.equal(JSON.parse(output[0]!).error.category, 'confirmation_required');
});

test('plan mode is non-mutating for local credential custody', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['auth', 'logout', '--plan', '--market', 'local', '--json'], { interactiveUi: false, write: (value) => output.push(value) });
	assert.equal(exit, 0);
	assert.deepEqual(JSON.parse(output[0]!).result, { action: 'auth logout', mutation: false, authority: 'local_credential_custody' });
});

test('local managed control plane is the default and market passthrough is unavailable', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['auth', 'status', '--json'], {
		interactiveUi: false,
		env: { HOME: '/tmp/treeseed-cli-empty-home' },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 1);
	assert.match(JSON.parse(output[0]!).error.message, /Not logged in to local/u);
});

test('nonlocal command behavior is one authenticated API request', async () => {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-thin-'));
	const originalFetch = globalThis.fetch;
	const requests: Array<{ url: string; method: string; body: unknown }> = [];
	try {
		setMarketSession(root, { marketId: 'local', accessToken: 'test-access-token' });
		globalThis.fetch = async (input, init) => {
			requests.push({ url: String(input), method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ ok: true, payload: { source: 'api' } }), { status: 200, headers: { 'content-type': 'application/json' } });
		};
		const output: string[] = [];
		const exit = await runCommandLine(['capacity', 'status', '--team', 'treeseed', '--json'], { cwd: root, interactiveUi: false, env: { HOME: root }, write: (value) => output.push(value) });
		assert.equal(exit, 0);
		assert.deepEqual(JSON.parse(output[0]!).result, { source: 'api' });
		assert.equal(requests.length, 1);
		assert.equal(requests[0]!.url, 'http://127.0.0.1:3002/v1/operator/commands/read');
		assert.equal(requests[0]!.method, 'POST');
		assert.deepEqual(requests[0]!.body, {
			schemaVersion: 'treeseed.operator-command-request/v1', commandPath: ['capacity', 'status'], arguments: [], options: {}, mode: 'execute', context: { team: 'treeseed' },
		});
	} finally {
		globalThis.fetch = originalFetch;
		rmSync(root, { recursive: true, force: true });
	}
});
