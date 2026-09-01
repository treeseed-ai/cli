import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { hostUsesProtectedLocalTransport } from '../../../../src/cli/commands/host.ts';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { saveServerProfile, saveServerSession } from '../../../../src/cli/support/server-custody.ts';

test('provider code rotation pre-reads and replays the exact response ETag', async () => {
	const requests: Array<{ method: string; url: string; ifMatch?: string }> = [];
	const server = createServer((request, response) => {
		requests.push({ method: request.method ?? '', url: request.url ?? '', ifMatch: request.headers['if-match'] as string | undefined });
		response.setHeader('content-type', 'application/json');
		if (request.method === 'GET') response.setHeader('etag', '"code-revision-7"');
		response.end(JSON.stringify({ data: request.method === 'GET'
			? { schemaVersion: 'treeseed.provider-registration-code-status/v1', teamId: 'team-1', generation: 7, codePrefix: 'trsd_reg', rotatedAt: '2026-09-01T20:00:00.000Z' }
			: { schemaVersion: 'treeseed.provider-registration-code-receipt/v1', teamId: 'team-1', generation: 8, codePrefix: 'trsd_reg', registrationCode: 'redacted-in-test', rotatedAt: '2026-09-01T21:00:00.000Z' } }));
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-provider-code-')); const env = { TREESEED_CONFIG_HOME: root };
	try {
		const profile = { serverId: 'test', label: 'Test', baseUrl: `http://127.0.0.1:${address.port}` };
		saveServerProfile(profile, env); saveServerSession({ serverId: 'test', audience: profile.baseUrl, accessToken: 'access-token' }, env);
		assert.equal(await runCommandLine(['providers', 'registration', 'code', 'rotate', '--server', 'test', '--team', 'team-1', '--yes', '--json'], { env, interactiveUi: false, write() {} }), 0);
		assert.deepEqual(requests, [
			{ method: 'GET', url: '/v1/teams/team-1/capacity-provider-registration-code', ifMatch: undefined },
			{ method: 'POST', url: '/v1/teams/team-1/capacity-provider-registration-code/rotate', ifMatch: '"code-revision-7"' },
		]);
	} finally { await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept())); rmSync(root, { recursive: true, force: true }); }
});

test('provider environment set uses hidden input and never emits the value', async () => {
	const secret = 'provider-local-secret'; const calls: any[] = []; const output: string[] = [];
	const exit = await runCommandLine(['host', 'provider', 'environment', 'set', 'runtime', 'OPENAI_API_KEY', '--json'], {
		interactiveUi: false, promptSecret: async () => secret,
		hostInvoke: async (input) => { calls.push(input); return { id: 'runtime', variables: [{ name: 'OPENAI_API_KEY', available: true }] }; },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0); assert.equal(calls[0].handlerId, 'local.host.provider.environment.set');
	assert.deepEqual(JSON.parse(calls[0].options.payload), { profileId: 'runtime', name: 'OPENAI_API_KEY', value: secret });
	assert.equal(JSON.stringify(output).includes(secret), false);
	assert.equal(hostUsesProtectedLocalTransport({ command: { name: 'host provider environment set' } as any }), true);
});

test('provider environment list accepts no profile argument', async () => {
	const calls: any[] = [];
	const exit = await runCommandLine(['host', 'provider', 'environment', 'list', '--json'], {
		interactiveUi: false,
		hostInvoke: async (input) => { calls.push(input); return { profiles: [] }; },
		write() {},
	});
	assert.equal(exit, 0);
	assert.equal(calls[0].handlerId, 'local.host.provider.environment.list');
	assert.deepEqual(calls[0].arguments, []);
});

test('provider environment rotation accepts standard input without a plaintext argument', async () => {
	const calls: any[] = [];
	const exit = await runCommandLine(['host', 'provider', 'environment', 'rotate', 'runtime', 'API_TOKEN', '--stdin', '--json'], {
		interactiveUi: false, readStdin: async () => 'replacement-secret\n',
		hostInvoke: async (input) => { calls.push(input); return { id: 'runtime', generation: 2 }; }, write() {},
	});
	assert.equal(exit, 0);
	assert.deepEqual(JSON.parse(calls[0].options.payload), { profileId: 'runtime', name: 'API_TOKEN', value: 'replacement-secret' });
	assert.equal(calls[0].options.stdin, undefined);
});

test('provider environment import reads values locally and forwards no host path', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-provider-environment-')); const file = resolve(root, 'runtime.env'); const calls: any[] = [];
	try {
		writeFileSync(file, 'API_TOKEN=private-value\n');
		const exit = await runCommandLine(['host', 'provider', 'environment', 'import', 'runtime', '--env-file', file, '--json'], {
			interactiveUi: false, hostInvoke: async (input) => { calls.push(input); return { id: 'runtime', imported: 1 }; }, write() {},
		});
		assert.equal(exit, 0);
		assert.deepEqual(JSON.parse(calls[0].options.payload), { profileId: 'runtime', envFile: 'API_TOKEN=private-value\n' });
		assert.equal(JSON.stringify(calls[0]).includes(file), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
