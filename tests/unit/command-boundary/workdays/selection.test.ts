import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { getOperationInputField, setOperationInputField } from '../../../../src/cli/support/operations/input-fields.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';

const base = ['workdays', 'plan', '--team', '11111111-1111-4111-8111-111111111111', '--profile', 'documentation', '--projects', 'sdk', '--start', '2030-01-01T00:00:00Z', '--duration', '600', '--json'];

test('rejects every retired execution authority command before any invocation in both plan and execute mode and retains a valid original planning retry', async () => {
	for (const name of ['agent-author', 'capacity-plan-create', 'checkpoint-integrate', 'content-integrate', 'content-abandon']) {
		for (const planned of [false, true]) {
			const argv = [name, '--team', base[3]!, ...(planned ? ['--plan'] : []), '--json'], before = structuredClone(argv), output: string[] = [];
			let invoked = 0;
			assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
				operationInvoke: async () => { invoked++; return { data: {} }; } }), 1);
			assert.equal(invoked, 0); assert.equal(output.length, 1);
			const envelope = JSON.parse(output[0]!); assert.equal(envelope.ok, false); assert.equal(envelope.result, null);
			assert.equal(envelope.error.code, 'unknown_command'); assert.equal(envelope.error.category, 'unknown_command');
			assert.deepEqual(envelope.warnings, []); assert.deepEqual(argv, before);
		}
	}
	const before = structuredClone(base), calls: Array<{ operationId: string; input: unknown }> = [], output: string[] = [];
	assert.equal(await runCommandLine([...base], { interactiveUi: false, write: value => output.push(value),
		operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { id: 'original-preflight' } }; } }), 0);
	assert.deepEqual(calls, [{ operationId: 'workdays.plan', input: { path: { teamId: base[3] }, query: {}, body: {
		profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600,
	} } }]);
	assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
	assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, { id: 'original-preflight' }); assert.deepEqual(envelope.warnings, []);
	assert.deepEqual(base, before);
});

test('high-level allocation options use one nested policy input', async () => {
	let body: any;
	assert.equal(await runCommandLine([...base, '--planning-percent', '20', '--allocation-weight', '2',
		'--planning-turn-maximum-seconds', '180', '--project-percentages', '{"sdk":60,"api":40}',
		'--agent-class-percentages', '{"sdk":{"engineer":100}}'], {
		interactiveUi: false, write() {}, operationInvoke: async (_id, input) => { body = input.body; return { data: {} }; },
	}), 0);
	assert.deepEqual(body.allocation, { planningPercent: 20, allocationWeight: 2, planningTurnMaximumSeconds: 180,
		projectPercentages: { sdk: 60, api: 40 }, agentClassPercentages: { sdk: { engineer: 100 } } });
});

for (const options of [['--project-percentages', 'invalid'], ['--allocation-weight', '0'], ['--planning-percent', '101']]) {
	test(`invalid allocation ${JSON.stringify(options)} never invokes the API`, async () => {
		let calls = 0;
		assert.equal(await runCommandLine([...base, ...options], { interactiveUi: false, write() {},
			operationInvoke: async () => { calls++; } }), 1);
		assert.equal(calls, 0);
	});
}

test('repeated and CSV selectors become a normalized intersecting nested intent', async () => {
	const calls: Array<{ operationId: string; input: any }> = [];
	const exit = await runCommandLine([...base, '--agent', 'reviewer,architect', '--agent', 'reviewer', '--activity', 'reviewing', '--class', 'engineering'], {
		interactiveUi: false, write() {}, operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: {} }; },
	});
	assert.equal(exit, 0); assert.equal(calls.length, 1); assert.equal(calls[0]!.operationId, 'workdays.plan');
	assert.deepEqual(calls[0]!.input.body.agentSelection, { classIds: [], classSlugs: ['engineering'], agentSlugs: ['architect', 'reviewer'], activityTypes: ['reviewing'], mode: 'intersection' });
	assert.equal(Object.keys(calls[0]!.input.body).some(key => key.includes('.')), false);
});

test('repeated and CSV accepted decisions become one normalized selection', async () => {
	let body: any;
	const exit = await runCommandLine([...base, '--decision', 'decision-b,decision-a', '--decision', 'decision-b'], {
		interactiveUi: false, write() {}, operationInvoke: async (_operationId, input) => { body = input.body; return { data: {} }; },
	});
	assert.equal(exit, 0);
	assert.deepEqual(body.decisionIds, ['decision-a', 'decision-b']);
});

test('omitted selection leaves the full intent unchanged', async () => {
	let body: any;
	assert.equal(await runCommandLine(base, { interactiveUi: false, write() {}, operationInvoke: async (_id, input) => { body = input.body; return { data: {} }; } }), 0);
	assert.equal(Object.hasOwn(body, 'agentSelection'), false);
});

for (const selector of [['--agent', ''], ['--agent', 'reviewer,'], ['--activity', 'acting'], ['--activity', 'reviewng']]) {
	test(`invalid selection ${JSON.stringify(selector)} never invokes the API`, async () => {
		let calls = 0; const output: string[] = [];
		assert.equal(await runCommandLine([...base, ...selector], { interactiveUi: false, write: value => output.push(value), operationInvoke: async () => { calls++; } }), 1);
		assert.equal(calls, 0);
		const error = JSON.parse(output[0]!).error;
		assert.equal(error.category, 'invalid_input');
		assert.equal(error.code, selector[1] === '' ? 'invalid_input' : 'workday_agent_selection_invalid');
	});
}

test('empty decision selection never invokes the API', async () => {
	let calls = 0;
	assert.equal(await runCommandLine([...base, '--decision', 'decision,'], { interactiveUi: false, write() {}, operationInvoke: async () => { calls++; } }), 1);
	assert.equal(calls, 0);
});

test('nested bindings reject prototype traversal, collisions, and excessive depth', () => {
	const input = {}; setOperationInputField(input, 'agentSelection.agentSlugs', ['reviewer']);
	assert.deepEqual(getOperationInputField(input, 'agentSelection.agentSlugs'), ['reviewer']);
	assert.equal(getOperationInputField(input, 'missing.value'), undefined);
	for (const path of ['__proto__.polluted', 'constructor.prototype', 'x..y', 'a.b.c.d.e.f.g.h.i']) assert.throws(() => setOperationInputField(input, path, true), /Unsafe/u);
	assert.throws(() => setOperationInputField(input, 'agentSelection.agentSlugs', []), /Duplicate/u);
	assert.throws(() => setOperationInputField(input, 'agentSelection.agentSlugs.x', true), /Conflicting/u);
	assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('normalizes exact repeated CSV decision bytes for direct and scheduled intents without deriving acting authority', async () => {
	// Literal canonical ASCII order; case-distinct identifiers remain distinct.
	const expected = ['A', 'Z', 'a', 'a-1', 'a.1', 'a/1', 'a:1'];
	const variants = [
		['--decision', ' a:1,a.1,a ', '--decision', 'a/1,Z,a-1,A', '--decision', 'A'],
		['--decision', 'A,Z,a,a-1,a.1,a/1,a:1'],
		['--decision', 'a.1', '--decision', ' A ', '--decision', 'a,Z,a:1,a/1,a-1,a.1'],
	];
	for (const scheduled of [false, true]) for (const selection of variants) {
		const argv = scheduled ? ['workdays', 'schedules', 'start', ...base.slice(2), '--cadence-seconds', '3600', ...selection] : [...base, ...selection];
		const before = structuredClone(argv), calls: Array<{ operationId: string; input: unknown }> = [], output: string[] = [];
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
			operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { accepted: true } }; } }), 0);
		const intent = { profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600, decisionIds: expected };
		assert.deepEqual(calls, [{ operationId: scheduled ? 'workdays.schedules.create' : 'workdays.plan', input: {
			path: { teamId: base[3] }, query: {}, body: scheduled ? { intent, cadenceSeconds: 3600 } : intent,
		} }]);
		assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, { accepted: true }); assert.deepEqual(envelope.warnings, []);
		assert.deepEqual(argv, before); assert.deepEqual(expected, ['A', 'Z', 'a', 'a-1', 'a.1', 'a/1', 'a:1']);
	}
	for (const scheduled of [false, true]) {
		const ids = Array.from({ length: 64 }, (_, index) => `decision-${String(index).padStart(2, '0')}`); ids[63] = 'z'.repeat(200);
		const argv = scheduled ? ['workdays', 'schedules', 'start', ...base.slice(2), '--cadence-seconds', '3600'] : [...base];
		const calls: unknown[] = [];
		assert.equal(await runCommandLine([...argv, '--decision', ids.join(','), '--decision', ids[0]!], { interactiveUi: false, write() {},
			operationInvoke: async (_id, input) => { calls.push(input); return { data: {} }; } }), 0);
		const intent = { profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600, decisionIds: ids };
		assert.deepEqual(calls, [{ path: { teamId: base[3] }, query: {}, body: scheduled ? { intent, cadenceSeconds: 3600 } : intent }]);
		const omitted: unknown[] = [];
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write() {}, operationInvoke: async (_id, input) => { omitted.push(input); return { data: {} }; } }), 0);
		const fullIntent = { profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600 };
		assert.deepEqual(omitted, [{ path: { teamId: base[3] }, query: {}, body: scheduled ? { intent: fullIntent, cadenceSeconds: 3600 } : fullIntent }]);
	}
});

test('denies every malformed direct or scheduled decision selection and retired derived option before invocation', async () => {
	const invalid = ['', ' ', ',', 'decision,', ',decision', 'decision,,other', 'decision, ', 'x'.repeat(201), 'é', 'e\u0301', '\uE000', '\u{10000}', 'decision?',
		Array.from({ length: 65 }, (_, index) => `decision-${index}`).join(',')];
	for (const scheduled of [false, true]) for (const value of invalid) {
		const argv = scheduled ? ['workdays', 'schedules', 'start', ...base.slice(2), '--cadence-seconds', '3600', '--decision', value]
			: [...base, '--decision', value];
		const before = structuredClone(argv), output: string[] = []; let calls = 0;
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write: text => output.push(text), operationInvoke: async () => { calls++; } }), 1, value);
		assert.equal(calls, 0, value); assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.equal(envelope.error.category, 'invalid_input');
		assert.deepEqual(envelope.warnings, []); assert.deepEqual(argv, before);
	}
	for (const option of ['--execution-plan', '--execution-plan-id', '--capacity-plan', '--capacity-plan-id', '--execution-input', '--execution-input-id', '--demand-set', '--demand-set-id']) {
		for (const command of [[...base], ['workdays', 'start', '--team', base[3]!, '--preflight', 'preflight-1', '--digest', `sha256:${'a'.repeat(64)}`, '--json']]) {
			const argv = [...command, option, 'caller-derived'], before = structuredClone(argv), output: string[] = []; let calls = 0;
			assert.equal(await runCommandLine(argv, { interactiveUi: false, write: text => output.push(text), operationInvoke: async () => { calls++; } }), 1);
			assert.equal(calls, 0); assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
			assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.equal(envelope.error.code, 'invalid_input'); assert.deepEqual(envelope.warnings, []);
			assert.deepEqual(argv, before);
		}
	}
});

test('binds start only to the supplied exact preflight identity and digest and never infers omitted authority', async () => {
	const digest = `sha256:${'a'.repeat(64)}`, calls: Array<{ operationId: string; input: unknown }> = [];
	const argv = ['workdays', 'start', '--team', base[3]!, '--preflight', 'preflight-1', '--digest', digest, '--json'];
	const before = structuredClone(argv), output: string[] = [];
	assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
		operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { started: true } }; } }), 0);
	assert.deepEqual(calls, [{ operationId: 'workdays.start', input: { path: { teamId: base[3] }, query: {}, body: { preflightId: 'preflight-1', preflightDigest: digest } } }]);
	assert.equal(output.length, 1); const result = JSON.parse(output[0]!);
	assert.equal(result.ok, true); assert.deepEqual(result.result, { started: true }); assert.deepEqual(result.warnings, []); assert.deepEqual(argv, before);
	for (const authority of [[], ['--preflight', 'preflight-1'], ['--digest', digest], ['--preflight', '', '--digest', digest], ['--preflight', 'preflight-1', '--digest', '']]) {
		const input = ['workdays', 'start', '--team', base[3]!, '--json', ...authority], frozen = structuredClone(input), errors: string[] = [];
		let invoked = 0;
		assert.equal(await runCommandLine(input, { interactiveUi: false, write: value => errors.push(value), operationInvoke: async () => { invoked++; } }), 1);
		assert.equal(invoked, 0); assert.equal(errors.length, 1); const envelope = JSON.parse(errors[0]!);
		assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []); assert.deepEqual(input, frozen);
	}
});

test('packaged native CLI preserves decision and preflight bytes through confirmation denial and exact retry without derived writes', { timeout: 30_000 }, async context => {
	// The package's actual bin, never the source entrypoint or a replacement runner. Missing dist must fail; no build/install/skip.
	const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
	assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const entrypoint = resolve(manifest.bin.trsd);
	const entryBytes = readFileSync(entrypoint), packageBytes = readFileSync(resolve('package.json'));
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-decision-start-'));
	const teamId = base[3]!, digest = `sha256:${'a'.repeat(64)}`, wrongDigest = `sha256:${'b'.repeat(64)}`;
	const selected = ['A', 'Z', 'a', 'a-1', 'a.1', 'a/1', 'a:1'];
	const preflight = { id: 'preflight-1', preflightDigest: digest };
	const confirmation = { schemaVersion: 'treeseed.confirmation-state/v1', principalId: 'isolated-operator', clientId: 'trsd',
		operationId: 'workdays.start', argumentsDigest: `sha256:${'c'.repeat(64)}`, expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'original-nonce', signature: 'controlled-signature' };
	const scheduleConfirmation = { ...confirmation, operationId: 'workdays.schedules.create', nonce: 'schedule-nonce' };
	const frozen = structuredClone({ selected, preflight, confirmation, scheduleConfirmation }), decodedConfirmations: unknown[] = [];
	const requests: Array<{ method: string | undefined; path: string | undefined; body: string; idempotency: string | undefined; confirmed: boolean }> = [];
	let mode: 'accept' | 'stale' | 'denied' | 'unavailable' = 'accept', child: ReturnType<typeof spawn> | undefined;
	// HTTP replies/confirmation/credential are controlled INPUTS, not API governance, signed admission, or a real workday.
	const server = createServer((request, response) => {
		let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += String(chunk); });
		request.on('end', () => {
			const key = request.headers['idempotency-key'], proof = request.headers['x-treeseed-confirmation'];
			requests.push({ method: request.method, path: request.url, body, idempotency: typeof key === 'string' ? key : undefined, confirmed: typeof proof === 'string' });
			if (typeof proof === 'string') decodedConfirmations.push(JSON.parse(Buffer.from(proof, 'base64url').toString('utf8')));
			response.setHeader('content-type', 'application/json');
			if (request.url === `/v1/teams/${teamId}/workday-runs/preflight`) { response.end(JSON.stringify({ data: preflight })); return; }
			const scheduled = request.url === `/v1/teams/${teamId}/workday-schedules`;
			if (!scheduled && request.url !== `/v1/teams/${teamId}/workday-runs`) { response.statusCode = 404; response.end(JSON.stringify({ status: 404, code: 'unexpected_route', title: 'Unexpected route.' })); return; }
			if (mode !== 'accept') {
				response.statusCode = mode === 'stale' ? 412 : mode === 'denied' ? 403 : 503;
				response.end(JSON.stringify({ status: response.statusCode, code: mode === 'stale' ? 'stale_preflight' : mode === 'denied' ? 'team_access_denied' : 'isolated_unavailable', title: 'Original native denial.' })); return;
			}
			if (typeof proof !== 'string') {
				response.statusCode = 409; response.end(JSON.stringify({ type: 'about:blank', title: 'Confirmation required', status: 409, code: 'confirmation_required',
					inputRequired: { type: 'input_required', requestId: 'original-request', prompt: 'Confirm exact start.', confirmation: scheduled ? scheduleConfirmation : confirmation } })); return;
			}
			response.end(JSON.stringify({ data: scheduled ? { scheduled: true } : { started: true, preflightId: preflight.id, preflightDigest: digest } }));
		});
	});
	try {
		await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
		const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'operator' }, clientId: 'trsd', scopes: ['treeseed:execution'],
			serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const execute = async (argv: string[]) => {
			const before = structuredClone(argv);
			child = spawn(process.execPath, [entrypoint, ...argv, '--server', 'local', '--json'], { cwd: process.cwd(), env, signal: context.signal, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = ''; child.stdout!.on('data', bytes => { stdout += String(bytes); }); child.stderr!.on('data', bytes => { stderr += String(bytes); });
			const code = await new Promise<number | null>((accept, reject) => { child!.once('error', reject); child!.once('close', accept); });
			assert.deepEqual(argv, before); return { code, stdout, stderr };
		};
		const plan = await execute([...base.slice(0, -1), '--decision', ' a:1,a.1,a ', '--decision', 'a/1,Z,a-1,A', '--decision', 'A']);
		assert.equal(plan.code, 0); assert.equal(plan.stderr, ''); const planEnvelope = JSON.parse(plan.stdout);
		assert.equal(planEnvelope.ok, true); assert.deepEqual(planEnvelope.result, preflight); assert.deepEqual(planEnvelope.warnings, []);
		assert.deepEqual(requests, [{ method: 'POST', path: `/v1/teams/${teamId}/workday-runs/preflight`, body: JSON.stringify({
			profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600, decisionIds: selected,
		}), idempotency: requests[0]?.idempotency, confirmed: false }]);
		assert.ok(requests[0]!.idempotency);
		const boundaryOffset = requests.length, boundaryId = 'z'.repeat(200);
		const boundary = await execute([...base.slice(0, -1), '--decision', ` ${boundaryId} `, '--decision', boundaryId]);
		assert.equal(boundary.code, 0); assert.equal(boundary.stderr, ''); assert.equal(JSON.parse(boundary.stdout).ok, true);
		assert.equal(requests.length, boundaryOffset + 1);
		assert.equal(requests[boundaryOffset]!.body, JSON.stringify({ profileId: 'documentation', projects: ['sdk'],
			startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600, decisionIds: [boundaryId] }));
		const scheduleOffset = requests.length;
		const schedule = await execute(['workdays', 'schedules', 'start', ...base.slice(2, -1), '--cadence-seconds', '3600',
			'--decision', ' a:1,a.1,a ', '--decision', 'a/1,Z,a-1,A', '--decision', 'A', '--yes', '--idempotency-key', 'original-schedule-key']);
		assert.equal(schedule.code, 0); assert.equal(schedule.stderr, ''); const scheduleEnvelope = JSON.parse(schedule.stdout);
		assert.equal(scheduleEnvelope.ok, true); assert.deepEqual(scheduleEnvelope.result, { scheduled: true }); assert.deepEqual(scheduleEnvelope.warnings, []);
		assert.deepEqual(requests.slice(scheduleOffset), [false, true].map(confirmed => ({ method: 'POST', path: `/v1/teams/${teamId}/workday-schedules`,
			body: JSON.stringify({ intent: { profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600, decisionIds: selected }, cadenceSeconds: 3600 }),
			idempotency: 'original-schedule-key', confirmed })));
		const start = ['workdays', 'start', '--team', teamId, '--preflight', preflight.id, '--digest', preflight.preflightDigest, '--yes', '--idempotency-key', 'original-start-key'];
		for (const selectedMode of ['accept', 'stale', 'denied', 'unavailable', 'accept'] as const) {
			mode = selectedMode; const offset = requests.length;
			const argv = selectedMode === 'stale' ? start.map(value => value === digest ? wrongDigest : value) : [...start];
			const result = await execute(argv), successful = selectedMode === 'accept';
			assert.equal(result.code, successful ? 0 : 1); assert.equal(successful ? result.stderr : result.stdout, '');
			const envelope = JSON.parse(successful ? result.stdout : result.stderr);
			assert.equal(envelope.ok, successful); assert.deepEqual(envelope.warnings, []);
			if (successful) assert.deepEqual(envelope.result, { started: true, preflightId: preflight.id, preflightDigest: digest });
			else { assert.equal(envelope.result, null); assert.equal(envelope.error.code, selectedMode === 'stale' ? 'stale_preflight' : selectedMode === 'denied' ? 'team_access_denied' : 'isolated_unavailable'); }
			const writes = requests.slice(offset); assert.equal(writes.length, successful ? 2 : 1);
			assert.deepEqual(writes, Array.from({ length: successful ? 2 : 1 }, (_, index) => ({ method: 'POST', path: `/v1/teams/${teamId}/workday-runs`,
				body: JSON.stringify({ preflightId: preflight.id, preflightDigest: selectedMode === 'stale' ? wrongDigest : digest }), idempotency: 'original-start-key', confirmed: successful && index === 1 })));
		}
		for (const argv of [[...base.slice(0, -1), '--decision', 'decision,'], ['workdays', 'start', '--team', teamId, '--preflight', preflight.id],
			[...base.slice(0, -1), '--decision', 'é'], [...base.slice(0, -1), '--decision', 'x'.repeat(201)],
			['workdays', 'schedules', 'start', ...base.slice(2, -1), '--cadence-seconds', '3600', '--decision', 'é'],
			['workdays', 'schedules', 'start', ...base.slice(2, -1), '--cadence-seconds', '3600', '--decision', 'x'.repeat(201)],
			[...start, '--execution-plan', 'caller-derived'], [...base.slice(0, -1), '--activity', 'acting']]) {
			const offset = requests.length, result = await execute(argv);
			assert.equal(result.code, 1); assert.equal(result.stdout, ''); const envelope = JSON.parse(result.stderr);
			assert.equal(envelope.ok, false); assert.equal(envelope.result, null); assert.deepEqual(envelope.warnings, []); assert.equal(requests.length, offset);
		}
		assert.deepEqual(decodedConfirmations, [scheduleConfirmation, confirmation, confirmation]);
		for (const name of ['agent-author', 'capacity-plan-create', 'checkpoint-integrate', 'content-integrate', 'content-abandon']) {
			for (const planned of [false, true]) {
				const offset = requests.length, result = await execute([name, '--team', teamId, ...(planned ? ['--plan'] : [])]);
				assert.equal(result.code, 1); assert.equal(result.stdout, '');
				const envelope = JSON.parse(result.stderr); assert.equal(envelope.ok, false); assert.equal(envelope.result, null);
				assert.equal(envelope.error.code, 'unknown_command'); assert.equal(envelope.error.category, 'unknown_command');
				assert.deepEqual(envelope.warnings, []); assert.equal(requests.length, offset);
			}
		}
		const retryOffset = requests.length, retry = await execute(base.slice(0, -1));
		assert.equal(retry.code, 0); assert.equal(retry.stderr, ''); const retryEnvelope = JSON.parse(retry.stdout);
		assert.equal(retryEnvelope.ok, true); assert.deepEqual(retryEnvelope.result, preflight); assert.deepEqual(retryEnvelope.warnings, []);
		assert.equal(requests.length, retryOffset + 1);
		assert.equal(requests[retryOffset]!.path, `/v1/teams/${teamId}/workday-runs/preflight`);
		assert.equal(requests[retryOffset]!.body, JSON.stringify({ profileId: 'documentation', projects: ['sdk'], startsAt: '2030-01-01T00:00:00Z', durationSeconds: 600 }));
		assert.deepEqual({ selected, preflight, confirmation, scheduleConfirmation }, frozen);
		assert.deepEqual(readFileSync(entrypoint), entryBytes); assert.deepEqual(readFileSync(resolve('package.json')), packageBytes);
	} finally {
		try {
			if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise<void>(accept => child!.once('close', () => accept())); }
		} finally {
			try { server.closeAllConnections(); await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); assert.equal(server.listening, false); }
			finally { rmSync(root, { recursive: true, force: true }); }
		}
	}
});
