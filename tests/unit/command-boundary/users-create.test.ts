import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../src/cli/runtime.ts';

const identity = ['users', 'create', '--email', 'adrian.webb@knowledge.coop', '--username', 'adrian', '--display-name', 'Adrian Webb'];

test('users create securely prompts twice and invokes the anonymous registration operation', async () => {
	const output: string[] = [];
	const prompts = ['a sufficiently long password', 'a sufficiently long password'];
	const calls: Array<{ operationId: string; input: any }> = [];
	const exit = await runCommandLine([...identity, '--yes', '--json'], {
		interactiveUi: false,
		promptSecret: async () => prompts.shift() ?? '',
		operationInvoke: async (operationId, input) => {
			calls.push({ operationId, input });
			return { data: { confirmationRequired: true, email: 'adrian.webb@knowledge.coop' } };
		},
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.equal(calls[0]?.operationId, 'accounts.register');
	assert.deepEqual(calls[0]?.input, { path: {}, query: {}, body: { email: 'adrian.webb@knowledge.coop', username: 'adrian', displayName: 'Adrian Webb', password: 'a sufficiently long password' } });
	assert.doesNotMatch(output[0]!, /sufficiently long password/u);
	assert.match(JSON.parse(output[0]!).result.nextAction, /mail\.treeseed\.localhost/u);
});

test('users create plan never prompts or exposes a password', async () => {
	const output: string[] = [];
	let prompts = 0;
	let invocations = 0;
	const exit = await runCommandLine([...identity, '--plan', '--json'], {
		interactiveUi: false,
		promptSecret: async () => { prompts += 1; return 'never'; },
		operationInvoke: async () => { invocations += 1; },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.equal(prompts, 0);
	assert.equal(invocations, 0);
	const result = JSON.parse(output[0]!).result;
	assert.equal(result.mutation, false);
	assert.equal(result.input.passwordSource, 'interactive-secret-prompt');
	assert.equal('password' in result.input, false);
});

test('users create rejects mismatched passwords without invoking the API or leaking either value', async () => {
	const output: string[] = [];
	const prompts = ['first secret value', 'second secret value'];
	let invocations = 0;
	const exit = await runCommandLine([...identity, '--yes', '--json'], {
		interactiveUi: false,
		promptSecret: async () => prompts.shift() ?? '',
		operationInvoke: async () => { invocations += 1; },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 1);
	assert.equal(invocations, 0);
	assert.equal(JSON.parse(output[0]!).error.code, 'password_mismatch');
	assert.doesNotMatch(output[0]!, /first secret|second secret/u);
});
