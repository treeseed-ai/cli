import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommandLine } from '../../../../src/cli/runtime/runtime.ts';

function context(fetchCalls: Array<{ url: string; method: string }>) {
	const writes: string[] = [];
	return {
		writes,
		overrides: {
			cwd: process.cwd(), interactiveUi: false,
			env: { ...process.env, TREESEED_CONTROL_PLANE_MODE: 'managed', TREESEED_API_BASE_URL: 'http://127.0.0.1:3002' },
			write: (value: string) => writes.push(value), spawn: () => ({ status: 0 }),
			confirm: async () => false,
		},
		fetchCalls,
	};
}

test('workday start plan is deterministic and performs no mutation', async () => {
	const calls: Array<{ url: string; method: string }> = [];
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		calls.push({ url: String(input), method: init?.method ?? 'GET' });
		if (String(input).includes('/profile')) return Response.json({ ok: true, payload: { team: { id: 'team-1' }, activity: { projects: [] } } });
		return Response.json({ ok: true, payload: { principal: {}, teams: [{ id: 'team-1' }] } });
	};
	try {
		const run = context(calls);
		const args = ['workdays', 'start', '--team', 'team-1', '--preflight', 'preflight-1', '--digest', 'sha256:abc', '--plan', '--json'];
		assert.equal(await runCommandLine(args, run.overrides), 0);
		const first = JSON.parse(run.writes.join('\n'));
		assert.equal(first.mode, 'plan');
		assert.equal(first.result.method, 'POST');
		assert.equal(calls.some((call) => call.method !== 'GET'), false);
		const secondRun = context([]);
		assert.equal(await runCommandLine(args, secondRun.overrides), 0);
		assert.deepEqual(JSON.parse(secondRun.writes.join('\n')).result, first.result);
	} finally { globalThis.fetch = previousFetch; }
});

test('mutations default to execute but fail closed without confirmation', async () => {
	const run = context([]);
	const exitCode = await runCommandLine(['assignments', 'cancel', 'assignment-1', '--market', 'local', '--team', 'team-1', '--json'], run.overrides);
	assert.equal(exitCode, 1);
	const envelope = JSON.parse(run.writes.join('\n'));
	assert.equal(envelope.error.category, 'confirmation_required');
});
