import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

for (const status of ['failed', 'complete'] as const) {
	test(`send preserves the ${status} receipt and reports the execution outcome`, async () => {
		const receipt = { sendId: 'send-test', status, targets: [{ invocationId: 'invocation-test',
			failure: status === 'failed' ? { code: 'sandbox_failed' } : null }] };
		const output: string[] = [];
		const exit = await runCommandLine(['send', 'test-channel', '@sdk/architect: Describe the state of the project.',
			'--team', '11111111-1111-4111-8111-111111111111', '--json'], {
			interactiveUi: false, operationInvoke: async () => ({ data: receipt }), write: value => output.push(value),
		});
		const envelope = JSON.parse(output.at(-1)!);
		assert.equal(exit, status === 'failed' ? 1 : 0);
		assert.equal(envelope.ok, status === 'complete');
		assert.deepEqual(envelope.result, receipt);
		assert.equal(envelope.error?.code ?? null, status === 'failed' ? 'communication_execution_failed' : null);
	});
}
