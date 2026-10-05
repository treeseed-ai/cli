import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

test('host lifecycle commands preserve plan/noop/result envelopes and never need a remote server', async () => {
	const calls: unknown[] = []; const output: string[] = [];
	const invoke = async (input: unknown) => { calls.push(input); return (input as { handlerId: string }).handlerId === 'local.dev.status'
		? { sessions: [] } : { state: 'stopped', changed: false }; };
	for (const action of ['stop', 'start'] as const) {
		for (const plan of [true, false]) {
			const args = ['host', action, ...(plan ? ['--plan'] : ['--yes']), '--json'];
			assert.equal(await runCommandLine(args, { interactiveUi: false, hostInvoke: invoke, write: (value) => output.push(value) }), 0);
			assert.deepEqual(calls.at(-1), { handlerId: `local.host.${action}`, arguments: [], options: plan ? { plan: true } : {} });
			if (!plan) assert.deepEqual(calls.at(-2), { handlerId: 'local.dev.status', arguments: [], options: { payload: '{"all":true}' } });
			assert.deepEqual(JSON.parse(output.at(-1)!).result, { state: 'stopped', changed: false });
		}
	}
});
