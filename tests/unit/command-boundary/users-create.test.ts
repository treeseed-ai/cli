import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../src/cli/runtime.ts';

const identity = ['users', 'create', '--email', 'operator@example.test', '--username', 'operator', '--display-name', 'Test Operator'];

test('users create securely prompts twice and invokes the anonymous registration operation', async () => {
	const output: string[] = [];
	const prompts = ['a sufficiently long password', 'a sufficiently long password'];
	const calls: Array<{ operationId: string; input: any }> = [];
	const exit = await runCommandLine([...identity, '--json'], {
		interactiveUi: false,
		promptSecret: async () => prompts.shift() ?? '',
		operationInvoke: async (operationId, input) => {
			calls.push({ operationId, input });
			return { data: { confirmationRequired: true, email: 'operator@example.test' } };
		},
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.equal(calls[0]?.operationId, 'accounts.register');
	assert.deepEqual(calls[0]?.input, { path: {}, query: {}, body: { email: 'operator@example.test', username: 'operator', displayName: 'Test Operator', password: 'a sufficiently long password' } });
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

test('users create prints an explicit success result in human mode', async () => {
	const output: string[] = [];
	const prompts = ['a sufficiently long password', 'a sufficiently long password'];
	const exit = await runCommandLine(identity, {
		interactiveUi: false,
		promptSecret: async () => prompts.shift() ?? '',
		operationInvoke: async () => ({ data: { confirmationRequired: true, email: 'operator@example.test' } }),
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.match(output[0]!, /User registration accepted for operator@example\.test\./u);
});

test('users create rejects mismatched passwords without invoking the API or leaking either value', async () => {
	const output: string[] = [];
	const prompts = ['first secret value', 'second secret value'];
	let invocations = 0;
	const exit = await runCommandLine([...identity, '--json'], {
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

test('users create fails deterministically when registration exceeds the configured timeout', async () => {
	const output: string[] = [];
	const prompts = ['a sufficiently long password', 'a sufficiently long password'];
	const exit = await runCommandLine([...identity, '--timeout', '1', '--json'], {
		interactiveUi: false,
		promptSecret: async () => prompts.shift() ?? '',
		operationInvoke: async () => new Promise(() => undefined),
		write: (value) => output.push(value),
	});
	assert.equal(exit, 1);
	assert.equal(JSON.parse(output[0]!).error.code, 'user_creation_timeout');
});
