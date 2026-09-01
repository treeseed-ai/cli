import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../src/cli/runtime.ts';
import { hostUsesProtectedLocalTransport } from '../../../src/cli/commands/host.ts';
import { saveServerSession } from '../../../src/cli/support/server-custody.ts';

test('host storage reset is destructive, environment-bounded, and uses retained manager authority', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-storage-reset-')); const calls: any[] = [];
	const env = { TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: 'http://127.0.0.1:3002' };
	try {
		saveServerSession({ serverId: 'local', audience: 'http://127.0.0.1:3002', accessToken: 'session', principal: { id: 'user-1' } as any,
			activeTeam: { id: '16549507-cebc-4a16-94c5-cf91defbd6a3', slug: 'treeseed', name: 'TreeSeed' } }, env);
		assert.equal(await runCommandLine(['host', 'storage', 'reset', 'cloudflare-r2', '--environment', 'preview', '--yes', '--json'], {
			env, interactiveUi: false, hostInvoke: async (input) => calls.push(input), write() {},
		}), 1);
		assert.equal(await runCommandLine(['host', 'storage', 'reset', 'cloudflare-r2', '--environment', 'production', '--yes', '--json'], {
			env, interactiveUi: false, hostInvoke: async (input) => { calls.push(input); return { recreated: true, empty: true }; }, write() {},
		}), 0);
		const payload = JSON.parse(calls[0].options.payload);
		assert.deepEqual({ action: payload.action, backend: payload.backend, environment: payload.environment },
			{ action: 'reset', backend: 'cloudflare-r2', environment: 'production' });
		assert.equal(payload.bootstrapToken, undefined);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('host uninstall plan is non-destructive and reaches the protected manager boundary', async () => {
	const calls: any[] = []; const output: string[] = [];
	const exit = await runCommandLine(['host', 'uninstall', '--plan', '--json'], {
		interactiveUi: false,
		hostInvoke: async (input) => { calls.push(input); return { schemaVersion: 'treeseed.host-uninstall-result/v1', mode: 'plan', resources: [] }; },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(calls, [{ handlerId: 'local.host.uninstall', arguments: [], options: { plan: true } }]);
	assert.equal(JSON.parse(output[0]!).mode, 'plan');
	assert.equal(hostUsesProtectedLocalTransport({ command: { name: 'host uninstall' } as any }), true);
});

test('host uninstall rejects incomplete execution confirmation before manager invocation', async () => {
	for (const argv of [
		['host', 'uninstall', '--yes', '--json'],
		['host', 'uninstall', '--confirm', '--json'],
	]) {
		let invocations = 0; const output: string[] = [];
		const exit = await runCommandLine(argv, {
			interactiveUi: false,
			hostInvoke: async () => { invocations += 1; },
			write: (value) => output.push(value),
		});
		assert.equal(exit, 1);
		assert.equal(invocations, 0);
		assert.equal(JSON.parse(output[0]!).error.category, 'confirmation_required');
	}
});

test('host uninstall preserves explicit security purge authorization', async () => {
	const calls: any[] = [];
	const exit = await runCommandLine(['host', 'uninstall', '--confirm', '--purge-security', '--yes', '--json'], {
		interactiveUi: false,
		hostInvoke: async (input) => { calls.push(input); return { schemaVersion: 'treeseed.host-uninstall-result/v1', mode: 'execute', removed: [] }; },
		write() {},
	});
	assert.equal(exit, 0);
	assert.deepEqual(calls, [{ handlerId: 'local.host.uninstall', arguments: [], options: { confirm: true, purgeSecurity: true, yes: true } }]);
});
