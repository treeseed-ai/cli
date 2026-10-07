import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';
import { resolveProjectSelector } from '../../../../src/cli/support/selectors/project.ts';

test('project selectors preserve exact IDs and resolve a team-scoped slug', async () => {
	const id = '8cbfb810-6da5-4da2-9ae9-cad53101253f';
	assert.equal(await resolveProjectSelector(id, undefined, async () => { throw new Error('unexpected read'); }), id);
	assert.equal(await resolveProjectSelector('sdk', 'team-a', async () => ({
		items: [
			{ id, slug: 'sdk', teamId: 'team-a' },
			{ id: 'other', slug: 'sdk', teamId: 'team-b' },
		],
	})), id);
});

test('project selectors reject missing and ambiguous slugs', async () => {
	await assert.rejects(resolveProjectSelector('missing', undefined, async () => ({ items: [] })), { code: 'project_not_found' });
	await assert.rejects(resolveProjectSelector('sdk', undefined, async () => ({
		items: [{ id: 'one', slug: 'sdk' }, { id: 'two', slug: 'sdk' }],
	})), { code: 'project_ambiguous' });
});

test('library lookup resolves a paginated slug to exact project and library bytes without deriving execution authority', async () => {
	const project = { id: 'original-project', slug: 'configured-project', teamId: 'original-team' };
	const library = { projectId: project.id, teamId: project.teamId, repositoryId: 'original-library', contentRepositoryRef: 'refs/heads/staging' };
	const supplied = { project, library }, before = structuredClone(supplied), calls: Array<{ id: string; input: unknown }> = [], output: string[] = [];
	const argv = ['library', 'show', project.slug, '--json'], held = structuredClone(argv);
	assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value), operationInvoke: async (id, input) => {
		calls.push({ id, input });
		const next = input !== null && typeof input === 'object' && 'query' in input && input.query !== null
			&& typeof input.query === 'object' && 'cursor' in input.query && input.query.cursor === 'original-next';
		return { data: id === 'projects.list' ? next
			? { items: [project] } : { items: [], nextCursor: 'original-next' } : library };
	} }), 0);
	assert.deepEqual(calls, [{ id: 'projects.list', input: { path: {}, query: { limit: 200 }, body: undefined } },
		{ id: 'projects.list', input: { path: {}, query: { limit: 200, cursor: 'original-next' }, body: undefined } },
		{ id: 'treedx.library.show', input: { path: { projectId: project.id }, query: {}, body: undefined } }]);
	assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
	assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, supplied); assert.deepEqual(envelope.warnings, []);
	assert.deepEqual(argv, held); assert.deepEqual(supplied, before);
});

test('library lookup retains missing ambiguous unbound and denied observations without invoking execution or repairing identity', async () => {
	for (const mode of ['missing', 'ambiguous', 'unbound', 'denied'] as const) {
		const project = { id: 'original-project', slug: 'configured-project' }, before = structuredClone(project);
		const calls: string[] = [], output: string[] = [], argv = ['library', 'show', project.slug, '--json'], held = structuredClone(argv);
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value), operationInvoke: async id => {
			calls.push(id);
			if (id === 'projects.list') return { data: { items: mode === 'missing' ? [] : mode === 'ambiguous' ? [project, { ...project, id: 'other-project' }] : [project] } };
			if (mode === 'denied') throw Object.assign(new Error('Original lookup denial'), { status: 403, code: 'team_access_denied' });
			return { data: { projectId: project.id } };
		} }), 1);
		assert.deepEqual(calls, mode === 'missing' || mode === 'ambiguous' ? ['projects.list'] : ['projects.list', 'treedx.library.show']);
		assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []);
		assert.equal(envelope.error.code, mode === 'missing' ? 'project_not_found' : mode === 'ambiguous' ? 'project_ambiguous'
			: mode === 'unbound' ? 'library_binding_unavailable' : 'team_access_denied');
		assert.deepEqual(project, before); assert.deepEqual(argv, held);
	}
});

test('packaged native library lookup preserves paginated active team identity and failed read history through exact retry without execution writes', { timeout: 30_000 }, async context => {
	const packageBytes = readFileSync(resolve('package.json')), manifest = JSON.parse(packageBytes.toString('utf8'));
	assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const entrypoint = resolve(manifest.bin.trsd), entryBytes = readFileSync(entrypoint);
	const root = mkdtempSync(resolve(tmpdir(), 'cli-library-lookup-'));
	const team = { id: '11111111-1111-4111-8111-111111111111', slug: 'original-team', name: 'Original team' };
	const project = { id: '22222222-2222-4222-8222-222222222222', slug: 'configured-project', teamId: team.id };
	const library = { projectId: project.id, teamId: team.id, repositoryId: 'original-library', contentRepositoryRef: 'refs/heads/staging' };
	const before = structuredClone({ project, library, team }), requests: Array<{ method: string | undefined; path: string | undefined; body: string; writeKey: boolean; confirmation: boolean }> = [];
	const failed: Array<{ code: number | null; stdout: string; stderr: string }> = [];
	let mode: 'accept' | 'missing' | 'ambiguous' | 'unbound' | 'denied' | 'unavailable' | 'reset' | 'json' = 'accept';
	let child: ReturnType<typeof spawn> | undefined;
	const server = createServer((incoming, outgoing) => {
		let body = ''; incoming.setEncoding('utf8'); incoming.on('data', bytes => { body += String(bytes); });
		incoming.on('end', () => {
			requests.push({ method: incoming.method, path: incoming.url, body, writeKey: incoming.headers['idempotency-key'] !== undefined,
				confirmation: incoming.headers['x-treeseed-confirmation'] !== undefined });
			const url = new URL(incoming.url ?? '', 'http://127.0.0.1'); outgoing.setHeader('content-type', 'application/json');
			if (incoming.method !== 'GET' || body) { outgoing.writeHead(500).end('{}'); return; }
			if (mode === 'reset') { incoming.socket.destroy(); return; }
			if (mode === 'json') { outgoing.end('{'); return; }
			if (mode === 'denied' || mode === 'unavailable') { const status = mode === 'denied' ? 403 : 503;
				outgoing.writeHead(status).end(JSON.stringify({ status, code: mode === 'denied' ? 'team_access_denied' : 'lookup_unavailable', title: 'Original read denial' })); return; }
			if (url.pathname === '/v1/projects') {
				const first = url.searchParams.get('cursor') !== 'original-next';
				outgoing.end(JSON.stringify({ data: first ? { items: [{ ...project, id: 'foreign-project', teamId: 'foreign-team' }], nextCursor: 'original-next' }
					: { items: mode === 'missing' ? [] : mode === 'ambiguous' ? [project, { ...project, id: 'duplicate-project' }] : [project] } })); return;
			}
			if (url.pathname === `/v1/projects/${project.id}/treedx-library`) {
				outgoing.end(JSON.stringify({ data: mode === 'unbound' ? { projectId: project.id } : library })); return;
			}
			outgoing.writeHead(500).end('{}');
		});
	});
	try {
		await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
		const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url };
		// Native custody and actual generated CLI/SDK transport; supplied token and responses are not native API governance.
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd', scopes: ['treeseed:read'],
			serverId: 'local', audience: url, accessToken: 'isolated-fixture-token', activeTeam: team }, env);
		const execute = async () => {
			child = spawn(process.execPath, [entrypoint, 'library', 'show', project.slug, '--json'], { cwd: process.cwd(), env, signal: context.signal, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = ''; child.stdout!.on('data', bytes => { stdout += String(bytes); }); child.stderr!.on('data', bytes => { stderr += String(bytes); });
			const code = await new Promise<number | null>((accept, reject) => { child!.once('error', reject); child!.once('close', accept); });
			return { code, stdout, stderr };
		};
		const success = await execute(); assert.equal(success.code, 0); assert.equal(success.stderr, '');
		assert.deepEqual(JSON.parse(success.stdout).result, { project, library });
		assert.deepEqual(requests.map(value => value.path), ['/v1/projects?limit=200', '/v1/projects?limit=200&cursor=original-next', `/v1/projects/${project.id}/treedx-library`]);
		for (const fault of ['missing', 'ambiguous', 'unbound', 'denied', 'unavailable', 'reset', 'json'] as const) {
			mode = fault; const result = await execute(); failed.push(result);
			assert.equal(result.code, 1); assert.equal(result.stdout, ''); const envelope = JSON.parse(result.stderr);
			assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []);
			if (!['reset', 'json'].includes(fault)) assert.equal(envelope.error.code, fault === 'missing' ? 'project_not_found' : fault === 'ambiguous' ? 'project_ambiguous'
				: fault === 'unbound' ? 'library_binding_unavailable' : fault === 'denied' ? 'team_access_denied' : 'lookup_unavailable');
		}
		const retained = structuredClone(failed), history = structuredClone(requests); mode = 'accept';
		const retry = await execute(); assert.equal(retry.code, 0); assert.equal(retry.stderr, ''); assert.deepEqual(JSON.parse(retry.stdout).result, { project, library });
		assert.deepEqual(failed, retained); assert.deepEqual(requests.slice(0, history.length), history);
		assert.ok(requests.every(value => value.method === 'GET' && !value.body && !value.writeKey && !value.confirmation));
		assert.deepEqual({ project, library, team }, before); assert.deepEqual(readFileSync(entrypoint), entryBytes); assert.deepEqual(readFileSync(resolve('package.json')), packageBytes);
	} finally {
		try { if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise<void>(accept => child!.once('close', () => accept())); } }
		finally { try { server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
			assert.equal(server.listening, false); } finally { rmSync(root, { recursive: true, force: true }); } }
	}
});
