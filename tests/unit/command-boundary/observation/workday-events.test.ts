import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { encodeCapacityPageCursor } from '@treeseed/sdk/capacity-pagination';
import { commandSpecs } from '../../../../src/cli/registry.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';

test('requires one generated read command for exact workday events with cursor and page limit', () => {
	const commands = commandSpecs.filter(command => command.execution.kind === 'operation'
		&& command.execution.operationId === 'workdays.events.list');
	assert.equal(commands.length, 1, 'Existing event operation is inaccessible to the supported CLI');
	assert.equal(commands[0]!.kind, 'read');
	assert.ok(commands[0]!.options.some(option => option.flag === '--cursor'));
	assert.ok(commands[0]!.options.some(option => option.flag === '--limit'));
	assert.ok(commands[0]!.options.some(option => option.flag === '--team'));
});

test('retrieves a later exact event page through independent native CLI and real HTTP transport', { timeout: 30_000 }, async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-event-observation-'));
	const teamId = '11111111-1111-4111-8111-111111111111', runId = 'workday-fixture';
	const cursor = encodeCapacityPageCursor({ id: 'event-049', createdAt: '2026-10-02T21:00:00Z' });
	const requests: string[] = [];
	// Isolated response input, not an authenticated production API or genuine event receipt.
	const result = { items: [{ id: 'event-050', runId, teamId, eventIndex: 50, eventType: 'assignment.failed',
		status: 'failed', createdAt: '2026-10-02T21:00:01Z' }], page: { limit: 50, hasMore: false, nextCursor: null } };
	const server = createServer((request, response) => {
		requests.push(request.url ?? ''); response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ data: result }));
	});
	let child: ReturnType<typeof spawn> | undefined;
	try {
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url, TSX_DISABLE_CACHE: '1' };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd',
			scopes: ['treeseed:read'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const bound = commandSpecs.find(command => command.execution.kind === 'operation' && command.execution.operationId === 'workdays.events.list');
		// Do not prescribe a new command name. Exercise a future bound catalog route;
		// until it exists, the current observation leaf itself must not count as proof.
		const path = bound?.path ?? ['workdays', 'watch'];
		child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...path, runId,
			'--team', teamId, '--cursor', cursor, '--limit', '50', '--json'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '', stderr = '';
		child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
		const code = await new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve); });
		assert.equal(code, 0, JSON.stringify({ requests, stdout, stderr }));
		assert.equal(requests.length, 1);
		const requested = new URL(requests[0]!, url);
		assert.equal(requested.pathname, `/v1/teams/${teamId}/workday-runs/${runId}/events`);
		assert.equal(requested.searchParams.get('cursor'), cursor); assert.equal(requested.searchParams.get('limit'), '50');
		assert.deepEqual(JSON.parse(stdout).result, result);
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill(); await new Promise<void>(resolve => child!.once('close', () => resolve()));
		}
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
