import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../src/cli/runtime.ts';
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
