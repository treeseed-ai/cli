import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';

const teamId = '11111111-1111-4111-8111-111111111111';
const base = ['assignments', 'recover', 'expired-attempt', '--team', teamId,
	'--state-version', '7', '--reason', 'Original active measurement unavailable'];

test('generated recovery transports only exact assignment version and reason without creating measured usage authority', async () => {
	const argv = [...base, '--yes', '--idempotency-key', 'original-recovery', '--json'], held = [...argv];
	const calls: Array<{ operationId: string; input: unknown }> = [], output: string[] = [];
	const unresolved = { assignmentId: 'expired-attempt', reservationId: 'held', usageStatus: 'unresolved', settled: false };
	assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
		operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: unresolved }; } }), 0);
	assert.deepEqual(calls, [{ operationId: 'assignments.recover', input: { path: { teamId, assignmentId: 'expired-attempt' }, query: {},
		body: { expectedStateVersion: 7, reason: base[8] } } }]);
	assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
	assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, unresolved); assert.deepEqual(envelope.warnings, []);
	assert.deepEqual(argv, held);
});

test('generated recovery denies missing malformed versions reasons and every supplied measurement selector before invocation', async () => {
	const variants = [base.slice(0, 5), base.slice(0, 7),
		...['', '0', '-1', '0.5', 'NaN', 'Infinity', '9007199254740992'].map(value => base.map((item, index) => index === 6 ? value : item)),
		...['', ' '].map(value => base.map((item, index) => index === 8 ? value : item)),
		...['actor-id', 'active-seconds', 'elapsed-seconds', 'usage-actual', 'native-usage', 'usd', 'lease-token', 'settled', 'usage-status']
			.map(field => [...base, `--${field}`, '0'])];
	for (const variant of variants) {
		const argv = [...variant, '--yes', '--json'], held = [...argv], output: string[] = []; let calls = 0;
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
			operationInvoke: async () => { calls++; return {}; } }), 1);
		assert.equal(calls, 0); assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []);
		assert.deepEqual(argv, held);
	}
});

test('packaged native recovery retains exact confirmation denial version and unresolved response through immutable retry without usage writes', { timeout: 30_000 }, async context => {
	const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
	assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const entry = resolve(manifest.bin.trsd), bytes = readFileSync(entry);
	const packageBytes = readFileSync(resolve('package.json')), root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-unresolved-recovery-'));
	const result = { assignmentId: 'expired-attempt', reservationId: 'held', usageStatus: 'unresolved', settled: false };
	const confirmation = { schemaVersion: 'treeseed.confirmation-state/v1', principalId: 'isolated-operator', clientId: 'trsd',
		operationId: 'assignments.recover', argumentsDigest: `sha256:${'a'.repeat(64)}`, expiresAt: '2030-01-01T00:00:00.000Z',
		nonce: 'original-recovery-nonce', signature: 'controlled-confirmation-input' };
	const held = structuredClone({ result, confirmation }), requests: Array<{ path: string; method: string; body: string; key: string; confirmation?: unknown }> = [];
	let denied = 0, child: ReturnType<typeof spawn> | undefined;
	// Controlled authority replies; real CLI/SDK/native children and HTTP, not native API governance or settlement.
	const server = createServer((request, response) => {
		let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += String(chunk); });
		request.on('end', () => {
			const proof = request.headers['x-treeseed-confirmation'];
			requests.push({ path: request.url ?? '', method: request.method ?? '', body, key: String(request.headers['idempotency-key'] ?? ''),
				...(typeof proof === 'string' ? { confirmation: JSON.parse(Buffer.from(proof, 'base64url').toString('utf8')) } : {}) });
			response.setHeader('content-type', 'application/json');
			if (denied) { response.statusCode = denied; response.end(JSON.stringify({ status: denied, code: `retained_denial_${denied}`, title: 'Original denial' })); }
			else if (typeof proof !== 'string') { response.statusCode = 409; response.end(JSON.stringify({ status: 409, code: 'confirmation_required',
				title: 'Confirmation required', inputRequired: { type: 'input_required', requestId: 'original-recovery', prompt: 'Confirm unresolved release.', confirmation } })); }
			else response.end(JSON.stringify({ data: result }));
		});
	});
	try {
		await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
		const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'operator' }, clientId: 'trsd',
			scopes: ['treeseed:execution'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const execute = async (argv: string[]) => {
			child = spawn(process.execPath, [entry, ...argv, '--server', 'local', '--json'], { cwd: process.cwd(), env, signal: context.signal, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = ''; child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
			const code = await new Promise<number | null>((accept, reject) => { child!.once('error', reject); child!.once('close', accept); });
			return { code, stdout, stderr };
		};
		for (const status of [0, 403, 409, 503, 0]) {
			denied = status; const offset = requests.length;
			const response = await execute([...base, '--yes', '--idempotency-key', 'original-recovery']);
			assert.equal(response.code, status ? 1 : 0); assert.equal(status ? response.stdout : response.stderr, '');
			const envelope = JSON.parse(status ? response.stderr : response.stdout);
			assert.equal(envelope.ok, !status); assert.deepEqual(envelope.warnings, []);
			if (status) { assert.equal(envelope.result, null); assert.equal(envelope.error.code, `retained_denial_${status}`); }
			else assert.deepEqual(envelope.result, result);
			assert.deepEqual(requests.slice(offset), Array.from({ length: status ? 1 : 2 }, (_, index) => ({ method: 'POST',
				path: `/v1/teams/${teamId}/capacity/assignments/expired-attempt/recover`,
				body: JSON.stringify({ expectedStateVersion: 7, reason: base[8] }), key: 'original-recovery',
				...(!status && index === 1 ? { confirmation } : {}) })));
		}
		const offset = requests.length;
		for (const argv of [base.slice(0, 5), [...base, '--active-seconds', '0'], [...base, '--actor-id', 'operator']]) assert.equal((await execute(argv)).code, 1);
		assert.equal(requests.length, offset); assert.deepEqual({ result, confirmation }, held);
		assert.ok(readFileSync(entry).equals(bytes)); assert.ok(readFileSync(resolve('package.json')).equals(packageBytes));
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise<void>(accept => child!.once('close', () => accept())); }
		server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
	assert.equal(server.listening, false);
});
