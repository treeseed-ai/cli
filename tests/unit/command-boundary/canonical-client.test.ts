import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { listCommandPaths, TREESEED_COMMAND_TREE_V1 } from '@treeseed/sdk/operator-contracts';
import { commandSpecs } from '../../../src/cli/registry.ts';
import { runCommandLine } from '../../../src/cli/runtime.ts';
import { loadServerSession, saveServerProfile, saveServerSession } from '../../../src/cli/support/server-custody.ts';

test('registry exactly matches the SDK command tree', () => {
	assert.deepEqual(commandSpecs.map((command) => command.name), listCommandPaths(TREESEED_COMMAND_TREE_V1));
	assert.equal(commandSpecs.some((command) => command.name.includes(':')), false);
});

test('send maps project-qualified recipients to the catalog without raw routes', async () => {
	const calls: Array<{ operationId: string; input: unknown }> = []; const output: string[] = [];
	const exit = await runCommandLine(['send', 'engineering', 'How should this work?', '--team', 'team-1', '--project', 'project-sdk', '--to', 'sdk/architect', '--json'], {
		interactiveUi: false, operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { sendId: 'send-1', status: 'queued' } }; }, write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(calls, [{ operationId: 'communications.send', input: { path: { teamId: 'team-1', channel: 'engineering' }, query: {}, body: { message: 'How should this work?', projectId: 'project-sdk', recipients: ['sdk/architect'] } } }]);
	assert.equal(JSON.parse(output[0]!).result.sendId, 'send-1');
});

test('leaf commands expose only catalog-derived high-level options', () => {
	const byName = new Map(commandSpecs.map((command) => [command.name, command.options.map((option) => option.flag)]));
	assert.deepEqual(byName.get('workdays start'), ['--server', '--team', '--preflight', '--digest', '--yes', '--json', '--plan']);
	assert.deepEqual(byName.get('plans show'), ['--server', '--json']);
	assert.deepEqual(byName.get('agents show'), ['--server', '--project', '--json']);
	assert.equal(commandSpecs.some((command) => command.options.some((option) => option.flag === '--execute' || option.flag === '--market')), false);
});

test('removed legacy commands are unknown without mutation', async () => {
	const output: string[] = [];
	for (const argv of [['capacity', 'capacity-plan-create'], ['agent-deploy'], ['content-integrate'], ['dev', 'start'], ['treedx', 'sync']]) {
		const exit = await runCommandLine([...argv, '--json'], { interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 1);
		assert.equal(JSON.parse(output.pop()!).error.category, 'unknown_command');
	}
});

test('plan mode prevents mutation operation invocation', async () => {
	const output: string[] = [];
	let invocations = 0;
	const exit = await runCommandLine(['workdays', 'start', '--team', 'team-1', '--preflight', 'p1', '--digest', 'sha256:x', '--plan', '--json'], { interactiveUi: false, operationInvoke: async () => { invocations += 1; }, write: (value) => output.push(value) });
	assert.equal(exit, 0);
	assert.equal(invocations, 0);
	assert.equal(JSON.parse(output[0]!).result.mutation, false);
});

test('plan mode is non-mutating for local credential custody', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['auth', 'logout', '--plan', '--server', 'local', '--json'], { interactiveUi: false, write: (value) => output.push(value) });
	assert.equal(exit, 0);
	assert.deepEqual(JSON.parse(output[0]!).result, { action: 'auth logout', mutation: false, authority: 'local_credential_custody' });
});

test('remote commands invoke exactly one SDK operation without a URL', async () => {
	const invocations: Array<{ operationId: string; input: unknown }> = [];
	const output: string[] = [];
	const exit = await runCommandLine(['capacity', 'status', '--team', 'team-1', '--json'], {
		interactiveUi: false,
		operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { data: { source: 'api' } }; },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(JSON.parse(output[0]!).result, { source: 'api' });
	assert.deepEqual(invocations, [{ operationId: 'capacity.status', input: { path: { teamId: 'team-1' }, query: {}, body: undefined } }]);
});

test('seed commands upload parsed portable bundles instead of API-local paths', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-seed-'));
	const file = resolve(root, 'treeseed.yaml');
	writeFileSync(file, `schemaVersion: treeseed.seed-bundle/v2\nname: treeseed\nversion: 1\ndescription: test\nenvironments: [local]\ndigest: sha256:${'0'.repeat(64)}\nresources:\n  teams: []\n  memberships: []\n  projects: []\n  repositories: []\nruntime:\n  capacityProviders: []\n`);
	const invocations: Array<{ operationId: string; input: any }> = [];
	try {
		const exit = await runCommandLine(['seeds', 'validate', file, '--json'], { cwd: root, interactiveUi: false,
			operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { data: { ok: true } }; }, write: () => undefined });
		assert.equal(exit, 0);
		assert.equal(invocations[0]?.operationId, 'seeds.validate');
		assert.deepEqual(invocations[0]?.input.path, {});
		assert.equal(invocations[0]?.input.body.bundle.schemaVersion, 'treeseed.seed-bundle/v2');
		assert.equal('file' in invocations[0]?.input.body, false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('seed plan derives the path identity from the uploaded portable bundle', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-seed-plan-'));
	const file = resolve(root, 'treeseed.yaml');
	writeFileSync(file, `schemaVersion: treeseed.seed-bundle/v2\nname: treeseed\nversion: 1\ndescription: test\nenvironments: [local]\ndigest: sha256:${'0'.repeat(64)}\nresources:\n  teams: []\n  memberships: []\n  projects: []\n  repositories: []\nruntime:\n  capacityProviders: []\n`);
	const invocations: any[] = [];
	try {
		const exit = await runCommandLine(['seeds', 'plan', file, '--json'], { interactiveUi: false,
			operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { planned: true }; }, write() {} });
		assert.equal(exit, 0);
		assert.equal(invocations[0]?.operationId, 'seeds.plan');
		assert.equal(invocations[0]?.input.path.name, 'treeseed');
		assert.equal(invocations[0]?.input.body.bundle.name, 'treeseed');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('body-bearing catalog operations receive an empty object when no fields are supplied', async () => {
	const invocations: Array<{ operationId: string; input: any }> = [];
	const exit = await runCommandLine(['seeds', 'verify', 'treeseed', '--json'], {
		interactiveUi: false,
		operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { verified: false }; },
		write() {},
	});
	assert.equal(exit, 0);
	assert.deepEqual(invocations, [{
		operationId: 'seeds.verify',
		input: { path: { name: 'treeseed' }, query: {}, body: {} },
	}]);
});

test('provider enrollment hands the unwrapped API receipt to trusted local custody', async () => {
	let requestBody = '';
	const server = createServer((request, response) => {
		request.on('data', (chunk) => { requestBody += String(chunk); });
		request.on('end', () => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ data: { teamId: 'team-1', enrollmentToken: 'one-time' } }));
		});
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-provider-enrollment-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		const profile = { serverId: 'test', label: 'Test', baseUrl: `http://127.0.0.1:${address.port}` };
		saveServerProfile(profile, env);
		saveServerSession({ serverId: 'test', audience: profile.baseUrl, accessToken: 'access-token' }, env);
		const handoffs: Record<string, unknown>[] = [];
		const output: string[] = [];
		const exit = await runCommandLine(['providers', 'connect', '--server', 'test', '--team', 'team-1', '--yes', '--json'], {
			env, interactiveUi: false,
			providerEnrollmentHandoff: async (input) => { handoffs.push(input); return { requestId: 'request-1' }; },
			write: (value) => output.push(value),
		});
		assert.equal(exit, 0);
		assert.equal(requestBody, '{}');
		assert.equal(handoffs[0]?.enrollmentToken, 'one-time');
		assert.deepEqual(JSON.parse(output[0]!).result, {
			teamId: 'team-1', connectionState: 'approval_required', provider: { requestId: 'request-1' },
		});
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});

test('unavailable commands fail closed before network or filesystem mutation', async () => {
	const output: string[] = [];
	let invocations = 0;
	const exit = await runCommandLine(['release', '--yes', '--json'], { interactiveUi: false, operationInvoke: async () => { invocations += 1; }, write: (value) => output.push(value) });
	assert.equal(exit, 1);
	assert.equal(invocations, 0);
	assert.equal(JSON.parse(output[0]!).error.code, 'standards_migration_not_enabled');
});

test('high-risk operations replay the exact request with signed server confirmation', async () => {
	const requests: Array<{ idempotency: string | undefined; confirmation: string | undefined }> = [];
	const confirmation = { schemaVersion: 'treeseed.confirmation-state/v1', principalId: 'user_1', clientId: 'trsd', operationId: 'workdays.start', argumentsDigest: `sha256:${'a'.repeat(64)}`, expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'nonce', signature: 'signature' };
	const server = createServer((request, response) => {
		requests.push({ idempotency: request.headers['idempotency-key'] as string | undefined, confirmation: request.headers['x-treeseed-confirmation'] as string | undefined });
		response.setHeader('content-type', requests.length === 1 ? 'application/problem+json' : 'application/json');
		response.statusCode = requests.length === 1 ? 409 : 200;
		response.end(JSON.stringify(requests.length === 1
			? { type: 'about:blank', title: 'Confirmation required', status: 409, code: 'confirmation_required', inputRequired: { type: 'input_required', requestId: 'request_1', prompt: 'Confirm exact workday start.', confirmation } }
			: { data: { started: true } }));
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-confirmation-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		const profile = { serverId: 'test', label: 'Test', baseUrl: `http://127.0.0.1:${address.port}` };
		saveServerProfile(profile, env);
		saveServerSession({ serverId: 'test', audience: profile.baseUrl, accessToken: 'access-token' }, env);
		const output: string[] = [];
		const exit = await runCommandLine(['workdays', 'start', '--server', 'test', '--team', 'team-1', '--preflight', 'p1', '--digest', 'sha256:x', '--yes', '--json'], { env, interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 0);
		assert.deepEqual(JSON.parse(output[0]!).result, { started: true });
		assert.equal(requests.length, 2);
		assert.equal(requests[0]!.idempotency, requests[1]!.idempotency);
		assert.equal(requests[0]!.confirmation, undefined);
		assert.deepEqual(JSON.parse(Buffer.from(requests[1]!.confirmation!, 'base64url').toString('utf8')), confirmation);
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});

test('expired sessions rotate through OAuth before invoking the operation', async () => {
	const requests: Array<{ url: string; authorization: string | undefined; body: string }> = [];
	let baseUrl = '';
	const server = createServer((request, response) => {
		let body = '';
		request.on('data', (chunk) => { body += String(chunk); });
		request.on('end', () => {
			requests.push({ url: request.url ?? '', authorization: request.headers.authorization, body });
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(request.url === '/oauth/token'
				? { token_type: 'Bearer', access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 600, scope: 'treeseed:read', audience: baseUrl }
				: { data: { healthy: true } }));
		});
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	baseUrl = `http://127.0.0.1:${address.port}`;
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-refresh-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		saveServerProfile({ serverId: 'test', label: 'Test', baseUrl }, env);
		saveServerSession({ serverId: 'test', audience: baseUrl, accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: '2020-01-01T00:00:00.000Z' }, env);
		const output: string[] = [];
		const exit = await runCommandLine(['status', '--server', 'test', '--json'], { env, interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 0);
		assert.deepEqual(JSON.parse(output[0]!).result, { healthy: true });
		assert.equal(requests[0]!.url, '/oauth/token');
		assert.match(requests[0]!.body, /grant_type=refresh_token/u);
		assert.equal(requests[1]!.authorization, 'Bearer new-access');
		assert.equal(loadServerSession('test', env)?.refreshToken, 'new-refresh');
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});

test('JSON device login keeps human approval instructions off stdout', async () => {
	let baseUrl = '';
	const server = createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify(request.url === '/oauth/device_authorization'
			? { device_code: 'device-a', user_code: 'ABCD-EFGH', verification_uri: `${baseUrl}/approve`,
				verification_uri_complete: `${baseUrl}/approve?user_code=ABCD-EFGH`, expires_in: 60, interval: 0 }
			: request.url === '/oauth/token' ? { token_type: 'Bearer', access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 600,
				scope: 'treeseed:read', audience: baseUrl }
				: { data: { principal: { id: 'user-a', displayName: 'Adrian Webb' }, teams: [] } }));
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	baseUrl = `http://127.0.0.1:${address.port}`;
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-device-'));
	const output: Array<{ value: string; stream?: string }> = [];
	try {
		saveServerProfile({ serverId: 'test', label: 'Test', baseUrl }, { TREESEED_CONFIG_HOME: root });
		const exit = await runCommandLine(['auth', 'login', '--server', 'test', '--yes', '--json'], {
			env: { TREESEED_CONFIG_HOME: root }, interactiveUi: false,
			write: (value, stream) => output.push({ value, stream }),
		});
		assert.equal(exit, 0, JSON.stringify(output));
		assert.match(output.find(({ stream }) => stream === 'stderr')!.value, /ABCD-EFGH/u);
		const stdout = output.filter(({ stream }) => stream === 'stdout');
		assert.equal(stdout.length, 1);
		assert.equal(JSON.parse(stdout[0]!.value).ok, true);
		assert.equal(JSON.parse(stdout[0]!.value).result.principal.displayName, 'Adrian Webb');
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});
