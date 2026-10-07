import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { encodeCapacityPageCursor } from '@treeseed/sdk/capacity-pagination';
import { commandSpecs } from '../../../../src/cli/registry.ts';
import { parseInvocation } from '../../../../src/cli/parser.ts';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
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

test('binds optional workday diagnostic detail to the sole generated read operation without deriving execution authority', async () => {
	const held = structuredClone(commandSpecs), commands = commandSpecs.filter(command => command.execution.kind === 'operation'
		&& command.execution.operationId === 'workdays.events.list');
	assert.equal(commands.length, 1); const command = commands[0]!;
	assert.equal(command.kind, 'read'); assert.equal(command.confirmation, 'never');
	assert.deepEqual(command.options.filter(option => option.flag === '--diagnostics'), [
		{ name: 'diagnostics', flag: '--diagnostics', kind: 'string', description: 'Diagnostic detail: metadata or full.' },
	]);
	assert.equal(command.execution.kind, 'operation');
	if (command.execution.kind !== 'operation') throw new Error('Original workday event operation is required.');
	assert.deepEqual(command.execution.input.filter(binding => binding.field === 'diagnostics'), [
		{ target: 'query', field: 'diagnostics', source: 'option', name: 'diagnostics', required: false, transform: 'identity' },
	]);
	for (const next of command.options) assert.throws(() => parseInvocation(command, ['workday-fixture', '--diagnostics', next.flag]), /Missing value for --diagnostics/u);
	assert.equal(parseInvocation(command, ['workday-fixture', '--diagnostics=--json']).options.diagnostics, '--json');
	assert.equal(parseInvocation(command, ['workday-fixture', '--cursor', '-literal']).options.cursor, '-literal');
	const teamId = '11111111-1111-4111-8111-111111111111', runId = 'workday-fixture';
	for (const detail of [undefined, 'metadata', 'full']) {
		const argv = [...command.path, runId, '--team', teamId, '--limit', '50', '--cursor', 'exact-cursor',
			...(detail === undefined ? [] : ['--diagnostics', detail]), '--json'];
		const before = structuredClone(argv), calls: unknown[] = [], output: string[] = [];
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
			operationInvoke: async (id, input) => { calls.push({ id, input }); return { data: { observed: true } }; } }), 0);
		assert.deepEqual(calls, [{ id: 'workdays.events.list', input: { path: { teamId, runId },
			query: { limit: 50, cursor: 'exact-cursor', ...(detail === undefined ? {} : { diagnostics: detail }) }, body: undefined } }]);
		assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, { observed: true }); assert.deepEqual(envelope.warnings, []);
		assert.deepEqual(argv, before);
	}
	const argv = [...command.path, runId, '--team', teamId, '--diagnostics', '--json'], before = structuredClone(argv), errors: string[] = [];
	let invoked = 0;
	assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => errors.push(value),
		operationInvoke: async () => { invoked++; } }), 1);
	assert.equal(invoked, 0); assert.equal(errors.length, 1); const error = JSON.parse(errors[0]!);
	assert.equal(error.ok, false); assert.equal(error.result, null); assert.equal(error.error.category, 'invalid_input');
	assert.deepEqual(error.warnings, []); assert.deepEqual(argv, before); assert.deepEqual(commandSpecs, held);
});

test('packaged native workday diagnostic readback preserves exact clock bytes and denied history through unchanged retry without execution requests', { timeout: 30_000 }, async context => {
	const packageBytes = readFileSync(resolve('package.json')), manifest = JSON.parse(packageBytes.toString('utf8'));
	assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const entrypoint = resolve(manifest.bin.trsd), entryBytes = readFileSync(entrypoint);
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-clock-diagnostics-'));
	const teamId = '11111111-1111-4111-8111-111111111111', runId = 'workday-fixture';
	const cursor = encodeCapacityPageCursor({ id: 'event-049', createdAt: '2026-10-07T12:00:00.000Z' });
	// Controlled raw diagnostic bytes, not native model clocks, API authorization or provider charges.
	const clock = { observedAt: '2026-10-07T12:00:01.250Z', startedAt: '2026-10-07T12:00:00.000Z',
		endsAt: '2026-10-07T12:01:00.000Z', remainingSeconds: 59 };
	const event = { id: 'event-050', runId, teamId, assignmentId: 'assignment-fixture', eventIndex: 50,
		eventType: 'provider.execution.completed', status: 'completed', createdAt: '2026-10-07T12:00:02.000Z',
		payload: { protection: { protected: true } }, protectedPayload: { providerEvents: [
			{ type: 'model.tool.result', callId: 'clock-original', tool: 'provider.assignment.clock', output: JSON.stringify(clock) },
		] } };
	const page = { items: [event], page: { limit: 50, hasMore: false, nextCursor: null } }, held = structuredClone(page);
	const requests: Array<{ method: string | undefined; url: string; body: string }> = [];
	let mode: 'accept' | 'denied' | 'unavailable' = 'accept', child: ReturnType<typeof spawn> | undefined;
	const server = createServer((request, response) => {
		let body = ''; request.setEncoding('utf8'); request.on('data', value => { body += String(value); });
		request.on('end', () => {
			requests.push({ method: request.method, url: request.url ?? '', body });
			response.setHeader('content-type', 'application/json');
			if (mode !== 'accept') {
				response.statusCode = mode === 'denied' ? 403 : 503;
				response.end(JSON.stringify({ status: response.statusCode, code: mode === 'denied' ? 'diagnostics_access_denied' : 'diagnostics_unavailable', title: 'Original diagnostic read failure.' })); return;
			}
			const detail = new URL(request.url ?? '', 'http://isolated.test').searchParams.get('diagnostics');
			const { protectedPayload: _protected, ...metadata } = event;
			response.end(JSON.stringify({ data: detail === 'full' ? page : { ...page, items: [metadata] } }));
		});
	});
	try {
		await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
		const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd',
			scopes: ['treeseed:read'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const execute = async (options: string[]) => {
			const command = commandSpecs.filter(value => value.execution.kind === 'operation' && value.execution.operationId === 'workdays.events.list');
			assert.equal(command.length, 1);
			const argv = [...command[0]!.path, runId, '--team', teamId, '--cursor', cursor, '--limit', '50', ...options, '--server', 'local', '--json'];
			const before = structuredClone(argv);
			child = spawn(process.execPath, [entrypoint, ...argv], { cwd: process.cwd(), env, signal: context.signal, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = ''; child.stdout!.on('data', bytes => { stdout += String(bytes); }); child.stderr!.on('data', bytes => { stderr += String(bytes); });
			const code = await new Promise<number | null>((accept, reject) => { child!.once('error', reject); child!.once('close', accept); });
			assert.deepEqual(argv, before); assert.equal(child.signalCode, null);
			const text = (code === 0 ? stdout : stderr).trim(); assert.ok(text, JSON.stringify({ code, stdout, stderr }));
			assert.equal((code === 0 ? stderr : stdout).trim(), '');
			return { code, envelope: JSON.parse(text) };
		};
		for (const detail of [undefined, 'metadata', 'full']) {
			const start = requests.length, result = await execute(detail === undefined ? [] : ['--diagnostics', detail]);
			assert.equal(result.code, 0); assert.equal(result.envelope.ok, true); assert.deepEqual(result.envelope.warnings, []);
			const { protectedPayload: _protected, ...metadata } = event;
			assert.deepEqual(result.envelope.result, detail === 'full' ? page : { ...page, items: [metadata] });
			assert.equal(requests.length, start + 1); const requested = new URL(requests.at(-1)!.url, url);
			assert.equal(requested.pathname, `/v1/teams/${teamId}/workday-runs/${runId}/events`);
			assert.equal(requested.searchParams.get('diagnostics'), detail ?? null); assert.equal(requested.searchParams.get('cursor'), cursor);
			assert.equal(requested.searchParams.get('limit'), '50'); assert.equal(requests.at(-1)!.method, 'GET'); assert.equal(requests.at(-1)!.body, '');
		}
		for (const failure of ['denied', 'unavailable'] as const) {
			mode = failure; const start = requests.length, failed = await execute(['--diagnostics', 'full']);
			assert.equal(failed.code, 1); assert.equal(failed.envelope.ok, false); assert.equal(failed.envelope.result, null);
			assert.equal(failed.envelope.error.code, failure === 'denied' ? 'diagnostics_access_denied' : 'diagnostics_unavailable');
			assert.deepEqual(failed.envelope.warnings, []); assert.equal(requests.length, start + 1); const deniedRequest = structuredClone(requests.at(-1)!);
			mode = 'accept'; const retried = await execute(['--diagnostics', 'full']);
			assert.equal(retried.code, 0); assert.deepEqual(retried.envelope.result, page); assert.equal(requests.length, start + 2);
			assert.deepEqual(requests.at(-1), deniedRequest); assert.deepEqual(requests[start], deniedRequest);
		}
		const start = requests.length, malformed = await execute(['--diagnostics']);
		assert.equal(malformed.code, 1); assert.equal(malformed.envelope.ok, false); assert.equal(malformed.envelope.result, null);
		assert.equal(malformed.envelope.error.category, 'invalid_input'); assert.equal(requests.length, start);
		assert.deepEqual(page, held); assert.deepEqual(readFileSync(entrypoint), entryBytes); assert.deepEqual(readFileSync(resolve('package.json')), packageBytes);
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise<void>(accept => child!.once('close', () => accept())); }
		server.closeAllConnections(); await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true }); assert.equal(server.listening, false); assert.equal(existsSync(root), false);
	}
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
