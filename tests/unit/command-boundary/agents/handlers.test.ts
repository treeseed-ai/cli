import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { commandSpecs } from '../../../../src/cli/registry.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';

const projectId = '22222222-2222-4222-8222-222222222222';
const handlers = [{ id: 'actor', origin: 'agent-package' }, { id: 'configured/renamed-handler', origin: 'project-runtime' }];

test('generated handler inspection uses exact project and renamed handler bytes through read only list and show bindings', async context => {
	const root = mkdtempSync(resolve(tmpdir(), 'cli-handler-unit-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const env = { TREESEED_CONFIG_HOME: root };
	for (const show of [false, true]) {
		const operationId = show ? 'agents.handlers.show' : 'agents.handlers.list';
		const specs = commandSpecs.filter(value => value.execution.kind === 'operation' && value.execution.operationId === operationId);
		assert.equal(specs.length, 1); const spec = specs[0]!;
		assert.equal(spec.kind, 'read'); assert.equal(spec.confirmation, 'never');
		assert.deepEqual(spec.path, ['agents', 'handlers', show ? 'show' : 'list']);
		const argv = [...spec.path, ...(show ? [handlers[1]!.id] : []), '--project', projectId, '--json'];
		const frozen = structuredClone(argv), calls: Array<{ operationId: string; input: unknown }> = [], output: string[] = [];
		const supplied = show ? { projectId, handler: handlers[1] } : { projectId, handlers }, before = structuredClone(supplied);
		assert.equal(await runCommandLine(argv, { interactiveUi: false, env, write: text => output.push(text),
			operationInvoke: async (id, input) => { calls.push({ operationId: id, input }); return { data: supplied }; } }), 0);
		assert.deepEqual(calls, [{ operationId, input: { path: { projectId, ...(show ? { handlerId: handlers[1]!.id } : {}) }, query: {}, body: undefined } }]);
		assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, supplied); assert.deepEqual(envelope.warnings, []);
		assert.deepEqual(argv, frozen); assert.deepEqual(supplied, before);
	}
});

test('handler inspection denies omitted empty authority and execution options before invocation while preserving unknown and denied handler errors', async context => {
	const root = mkdtempSync(resolve(tmpdir(), 'cli-handler-denial-unit-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const env = { TREESEED_CONFIG_HOME: root };
	for (const argv of [
		['agents', 'handlers', 'list'], ['agents', 'handlers', 'list', '--project', ''],
		['agents', 'handlers', 'show', '--project', projectId], ['agents', 'handlers', 'show', '', '--project', projectId],
		['agents', 'handlers', 'list', '--project', projectId, '--idempotency-key', 'not-a-write'],
		['agents', 'handlers', 'show', handlers[1]!.id, '--project', projectId, '--yes'],
	]) {
		const input = [...argv, '--json'], frozen = structuredClone(input), output: string[] = []; let invoked = 0;
		assert.equal(await runCommandLine(input, { interactiveUi: false, env, write: text => output.push(text), operationInvoke: async () => { invoked++; } }), 1);
		assert.equal(invoked, 0); assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []); assert.deepEqual(input, frozen);
	}
	for (const [status, code, category] of [[404, 'agent_handler_not_found', 'not_found'], [403, 'team_access_denied', 'authorization_denied'],
		[503, 'handler_inventory_unavailable', 'provider_unavailable']] as const) {
		const cause = Object.assign(new Error('Original inspection denial'), { status, code }), output: string[] = []; let invoked = 0;
		const input = ['agents', 'handlers', 'show', 'configured/unavailable', '--project', projectId, '--json'], frozen = structuredClone(input);
		assert.equal(await runCommandLine(input, { interactiveUi: false, env, write: text => output.push(text), operationInvoke: async () => { invoked++; throw cause; } }), 1);
		assert.equal(invoked, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.equal(envelope.error.code, code); assert.equal(envelope.error.category, category);
		assert.deepEqual(envelope.warnings, []); assert.deepEqual(input, frozen); assert.equal(cause.message, 'Original inspection denial');
	}
});

test('packaged native handler inspection preserves exact read paths origins and failed transport history through unchanged retry without execution requests', { timeout: 30_000 }, async context => {
	const packageBytes = readFileSync(resolve('package.json')), manifest = JSON.parse(packageBytes.toString('utf8'));
	assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const entrypoint = resolve(manifest.bin.trsd), entryBytes = readFileSync(entrypoint);
	// Held declared bin is mandatory: no build, installation, source fallback or skipped environment.
	const root = mkdtempSync(resolve(tmpdir(), 'cli-handler-inspection-'));
	const requests: Array<{ method: string | undefined; path: string | undefined; body: string; writeKey: boolean; confirmation: boolean }> = [];
	const failed: Array<{ code: number | null; stdout: string; stderr: string }> = [];
	const before = structuredClone(handlers); let mode: 'accept' | 'denied' | 'unavailable' | 'reset' | 'json' = 'accept';
	let child: ReturnType<typeof spawn> | undefined;
	const listPath = `/v1/projects/${projectId}/agent-handlers`, showPath = `${listPath}/${encodeURIComponent(handlers[1]!.id)}`;
	const server = createServer((incoming, outgoing) => {
		let body = ''; incoming.setEncoding('utf8'); incoming.on('data', bytes => { body += String(bytes); });
		incoming.on('end', () => {
			requests.push({ method: incoming.method, path: incoming.url, body, writeKey: incoming.headers['idempotency-key'] !== undefined,
				confirmation: incoming.headers['x-treeseed-confirmation'] !== undefined });
			if (incoming.method !== 'GET' || ![listPath, showPath].includes(incoming.url ?? '') || body) { outgoing.statusCode = 404; outgoing.end('{}'); return; }
			if (mode === 'reset') { incoming.socket.destroy(); return; }
			outgoing.setHeader('content-type', 'application/json');
			if (mode === 'json') { outgoing.end('{'); return; }
			if (mode !== 'accept') { outgoing.statusCode = mode === 'denied' ? 403 : 503;
				outgoing.end(JSON.stringify({ status: outgoing.statusCode, code: mode === 'denied' ? 'team_access_denied' : 'handler_inventory_unavailable', title: 'Original denied inspection.' })); return; }
			outgoing.end(JSON.stringify({ data: incoming.url === listPath ? { projectId, handlers } : { projectId, handler: handlers[1] } }));
		});
	});
	try {
		await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
		const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd', scopes: ['treeseed:read'],
			serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const execute = async (show: boolean) => {
			const argv = ['agents', 'handlers', show ? 'show' : 'list', ...(show ? [handlers[1]!.id] : []), '--project', projectId, '--server', 'local', '--json'];
			const frozen = structuredClone(argv), offset = requests.length;
			child = spawn(process.execPath, [entrypoint, ...argv], { cwd: process.cwd(), env, signal: context.signal, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = ''; child.stdout!.on('data', bytes => { stdout += String(bytes); }); child.stderr!.on('data', bytes => { stderr += String(bytes); });
			const code = await new Promise<number | null>((accept, reject) => { child!.once('error', reject); child!.once('close', accept); });
			assert.deepEqual(argv, frozen); assert.deepEqual(requests.slice(offset), [{ method: 'GET', path: show ? showPath : listPath, body: '', writeKey: false, confirmation: false }]);
			return { code, stdout, stderr };
		};
		for (const show of [false, true]) {
			const result = await execute(show); assert.equal(result.code, 0); assert.equal(result.stderr, ''); const envelope = JSON.parse(result.stdout);
			assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, show ? { projectId, handler: handlers[1] } : { projectId, handlers }); assert.deepEqual(envelope.warnings, []);
		}
		for (const fault of ['denied', 'unavailable', 'reset', 'json'] as const) {
			mode = fault; const result = await execute(fault === 'denied' || fault === 'reset'); failed.push(result);
			assert.equal(result.code, 1); assert.equal(result.stdout, ''); const envelope = JSON.parse(result.stderr);
			assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []);
			if (fault === 'denied' || fault === 'unavailable') assert.equal(envelope.error.code, fault === 'denied' ? 'team_access_denied' : 'handler_inventory_unavailable');
		}
		const retained = structuredClone(failed); mode = 'accept';
		for (const show of [false, true]) { const result = await execute(show); assert.equal(result.code, 0); assert.equal(result.stderr, '');
			assert.deepEqual(JSON.parse(result.stdout).result, show ? { projectId, handler: handlers[1] } : { projectId, handlers }); }
		assert.deepEqual(failed, retained); assert.equal(requests.length, 8); assert.deepEqual(handlers, before);
		assert.deepEqual(readFileSync(entrypoint), entryBytes); assert.deepEqual(readFileSync(resolve('package.json')), packageBytes);
	} finally {
		try { if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise<void>(accept => child!.once('close', () => accept())); } }
		finally { try { server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
			assert.equal(server.listening, false); } finally { rmSync(root, { recursive: true, force: true }); } }
	}
});
