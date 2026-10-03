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

test('reads exact project workday measured usage pages and denies transport failure through independent native CLI', { timeout: 30_000 }, async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-usage-pages-'));
	const teamId = '11111111-1111-4111-8111-111111111111', projectId = '22222222-2222-4222-8222-222222222222', workdayId = 'isolated-workday';
	const createdAt = '2026-10-02T21:00:01.000Z';
	const cursor = encodeCapacityPageCursor({ id: 'usage-001', createdAt });
	// Controlled public HTTP DTO inputs, not generated provider usage or settlement receipts.
	const measurement = (id: string) => ({ id, projectId, workDayId: workdayId, assignmentId: `assignment-${id}`,
		idempotencyKey: `key-${id}`, accountingMode: 'aggregate', assignmentAttempt: 1,
		activeSeconds: 1, elapsedSeconds: 1, nativeUsage: { activeSeconds: 1 }, createdAt });
	const first = { items: Array.from({ length: 100 }, (_, index) => measurement(`usage-${String(100 - index).padStart(3, '0')}`)),
		page: { limit: 100, hasMore: true, nextCursor: cursor } };
	const tail = { items: [measurement('usage-000')], page: { limit: 100, hasMore: false, nextCursor: null } };
	const before = structuredClone([first, tail]), requests: string[] = [];
	let denied = false, child: ReturnType<typeof spawn> | undefined;
	const server = createServer((request, response) => {
		requests.push(request.url ?? '');
		response.writeHead(denied ? 403 : 200, { 'content-type': 'application/json' });
		response.end(JSON.stringify(denied ? { status: 403, code: 'team_access_denied', title: 'Isolated denied authority.' }
			: { data: request.url?.includes('cursor=') ? tail : first }));
	});
	try {
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url, TSX_DISABLE_CACHE: '1' };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd',
			scopes: ['treeseed:read'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const commands = commandSpecs.filter(value => value.execution.kind === 'operation' && value.execution.operationId === 'capacity.usage');
		assert.equal(commands.length, 1); assert.equal(commands[0]!.kind, 'read');
		for (const selected of [undefined, cursor, cursor]) {
			child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...commands[0]!.path, '--team', teamId,
				'--project', projectId, '--workday', workdayId, '--limit', '100', ...(selected ? ['--cursor', selected] : []), '--json'],
			{ cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = '';
			child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
			const code = await new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve); });
			assert.equal(code, denied ? 1 : 0, JSON.stringify({ stdout, stderr }));
			const envelope = JSON.parse(denied ? stderr : stdout) as { ok: boolean; result?: unknown; error?: { code: string } };
			assert.equal(envelope.ok, !denied);
			if (denied) { assert.equal(envelope.result, null); assert.equal(envelope.error?.code, 'team_access_denied'); }
			else assert.deepEqual(envelope.result, selected ? tail : first);
			const requested = new URL(requests.at(-1)!, url);
			assert.equal(requested.pathname, `/v1/teams/${teamId}/capacity/usage`);
			assert.equal(requested.searchParams.get('projectId'), projectId); assert.equal(requested.searchParams.get('workDayId'), workdayId);
			assert.equal(requested.searchParams.get('limit'), '100'); assert.equal(requested.searchParams.get('cursor'), selected ?? null);
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
