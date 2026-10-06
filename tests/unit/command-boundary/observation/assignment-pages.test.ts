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

test('forwards exact assignment pages and transport denial through independent native CLI without hiding a failed tail', { timeout: 30_000 }, async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-assignment-pages-'));
	const teamId = '11111111-1111-4111-8111-111111111111';
	const cursor = encodeCapacityPageCursor({ id: 'assignment-001', createdAt: '2026-10-02T21:00:01.000Z' });
	// Controlled HTTP inputs, not actual owning SQL, provider results or live receipts.
	const first = { items: Array.from({ length: 50 }, (_, index) => ({ id: `assignment-${String(50 - index).padStart(3, '0')}`,
		teamId, workDayId: 'workday-target', status: 'completed', createdAt: '2026-10-02T21:00:01.000Z' })),
		page: { limit: 50, hasMore: true, nextCursor: cursor } };
	const tail = { items: [{ id: 'assignment-000', teamId, workDayId: 'workday-target', status: 'failed', createdAt: '2026-10-02T21:00:01.000Z' }],
		page: { limit: 50, hasMore: false, nextCursor: null } };
	const before = structuredClone([first, tail]), requests: string[] = [];
	let denied = false;
	const server = createServer((request, response) => {
		requests.push(request.url ?? '');
		response.writeHead(denied ? 403 : 200, { 'content-type': 'application/json' });
		response.end(JSON.stringify(denied ? { status: 403, code: 'team_access_denied', title: 'Isolated denied authority.' }
			: { data: request.url?.includes('cursor=') ? tail : first }));
	});
	let child: ReturnType<typeof spawn> | undefined;
	try {
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url, TSX_DISABLE_CACHE: '1' };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd',
			scopes: ['treeseed:read'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const command = commandSpecs.filter(value => value.execution.kind === 'operation' && value.execution.operationId === 'assignments.list');
		assert.equal(command.length, 1); assert.equal(command[0]!.kind, 'read');
		for (const selected of [undefined, cursor, cursor]) {
			child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...command[0]!.path,
				'--team', teamId, '--limit', '50', ...(selected ? ['--cursor', selected] : []), '--json'],
			{ cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = '';
			child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
			const code = await new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve); });
			assert.ok((denied ? stderr : stdout).trim(), JSON.stringify({ code, requests, stderr }));
			const envelope = JSON.parse(denied ? stderr : stdout) as { ok: boolean; result?: unknown; error?: { code: string } };
			assert.equal(code, denied ? 1 : 0, JSON.stringify({ stdout, stderr }));
			assert.equal(envelope.ok, !denied);
			if (denied) { assert.equal(envelope.result, null); assert.equal(envelope.error?.code, 'team_access_denied'); }
			else assert.deepEqual(envelope.result, selected ? tail : first);
			const requested = new URL(requests.at(-1)!, url);
			assert.equal(requested.pathname, `/v1/teams/${teamId}/capacity/assignments`);
			assert.equal(requested.searchParams.get('limit'), '50'); assert.equal(requested.searchParams.get('cursor'), selected ?? null);
			if (selected) denied = true;
		}
		assert.equal(requests.length, 3); assert.deepEqual([first, tail], before);
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill(); await new Promise<void>(resolve => child!.once('close', () => resolve()));
		}
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
