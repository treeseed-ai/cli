import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { graphRevisionSchema } from '@treeseed/sdk/agent-capacity';
import { commandSpecs } from '../../../../src/cli/registry.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';

test('native generated graph watch preserves exact full tail terminal cursors and denied transport without mutating input', { timeout: 30_000 }, async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-graph-watch-'));
	const teamId = '11111111-1111-4111-8111-111111111111', requests: string[] = [];
	const records = Array.from({ length: 101 }, (_, index) => graphRevisionSchema.parse({ schemaVersion: 'treeseed.graph-revision/v1',
		teamId, revision: index + 1, ruleRevision: 1, changedSourceRefs: [{ store: 'treedx', model: 'proposal', id: 'proposal', revision: 1,
			digest: `sha256:${'a'.repeat(64)}`, repository: 'team-library', commit: 'a'.repeat(40), path: 'proposals/proposal.mdx' }],
		graphDigest: `sha256:${(index + 1).toString(16).padStart(64, '0')}`, createdAt: '2026-10-03T00:00:00.000Z',
		changes: { added: [], changed: [], completed: [], blocked: [], stale: [], addedEdges: [], removedEdges: [] } }));
	const before = structuredClone(records); let denied = false, child: ReturnType<typeof spawn> | undefined;
	// Controlled public DTOs, NOT native API/SQL/producer completeness evidence.
	const server = createServer((request, response) => {
		requests.push(`${request.method} ${request.url}`);
		const url = new URL(request.url ?? '', 'http://127.0.0.1'), cursor = url.searchParams.get('cursor') ?? '0';
		const items = records.filter(record => record.revision > Number(cursor)).slice(0, 100);
		response.writeHead(denied ? 403 : 200, { 'content-type': 'application/json' });
		response.end(JSON.stringify(denied ? { status: 403, code: 'team_access_denied', title: 'Isolated graph denial.' }
			: { data: { items, nextCursor: items.length ? String(items.at(-1)!.revision) : cursor } }));
	});
	try {
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url, TSX_DISABLE_CACHE: '1' };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd',
			scopes: ['treeseed:read'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const commands = commandSpecs.filter(command => command.execution.kind === 'operation' && command.execution.operationId === 'execution.graph.watch');
		assert.equal(commands.length, 1); assert.equal(commands[0]!.kind, 'read');
		const outcomes = [];
		for (const cursor of ['0', '100', '101', '101']) {
			child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...commands[0]!.path,
				'--team', teamId, '--cursor', cursor, '--server', 'local', '--json'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = ''; child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
			const code = await new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve); });
			outcomes.push({ code, cursor, envelope: JSON.parse(denied ? stderr : stdout) });
			if (outcomes.length === 3) denied = true;
		}
		for (const [index, outcome] of outcomes.entries()) {
			assert.equal(outcome.code, index === 3 ? 1 : 0); assert.equal(outcome.envelope.ok, index !== 3);
			if (index === 3) { assert.equal(outcome.envelope.result, null); assert.equal(outcome.envelope.error.code, 'team_access_denied'); }
			else { const items = index === 0 ? records.slice(0, 100) : index === 1 ? records.slice(100) : [];
				assert.deepEqual(outcome.envelope.result, { items, nextCursor: index === 0 ? '100' : '101' }); }
			const requested = new URL(requests[index]!.slice(4), url); assert.equal(requested.pathname, `/v1/teams/${teamId}/execution-graph/events`);
			assert.equal(requested.searchParams.get('cursor'), outcome.cursor);
		}
		assert.deepEqual(records, before); assert.equal(requests.length, 4);
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise<void>(resolve => child!.once('close', () => resolve())); }
		server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
