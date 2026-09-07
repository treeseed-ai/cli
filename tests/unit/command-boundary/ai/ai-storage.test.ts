import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

test('AI storage verification uses fixed local authority and preserves a non-mutating plan', async () => {
	for (const plan of [false,true]) {
		const calls: unknown[] = [], output: string[] = [];
		const exit = await runCommandLine(['ai','storage','verify',...(plan ? ['--plan'] : ['--yes']),'--json'], {
			interactiveUi:false,hostInvoke:async input => {calls.push(input);return {trainingExecuted:false};},write:value => output.push(value),
		});
		assert.equal(exit,0,output.join('\n'));
		assert.deepEqual(calls,[{handlerId:'local.host.ai.storage.verify',arguments:[],options:plan ? {plan:true} : {}}]);
	}
});

test('AI storage binds exact team/node authority and explicit connection/bucket', async () => {
	const calls: Array<{ operationId: string; input: unknown }> = [], output: string[] = [];
	const node = '33333333-3333-4333-8333-333333333333', connection = '44444444-4444-4444-8444-444444444444';
	const exit = await runCommandLine(['ai', 'storage', 'connect', '--team', 'team-1', '--node', node, '--connection', connection,
		'--bucket', 'test-ai-artifacts', '--if-match', 'new', '--idempotency-key', 'storage-binding-1', '--json'], {
		interactiveUi: false, operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { configured: true } }; },
		write: value => output.push(value),
	});
	assert.equal(exit, 0, output.join('\n'));
	assert.deepEqual(calls, [{ operationId: 'ai.instances.storage.put', input: { path: { teamId: 'team-1', instanceId: node }, query: {}, body: { connectionId: connection, bucket: 'test-ai-artifacts' } } }]);
});
