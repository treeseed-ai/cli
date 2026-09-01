import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

test('host security prerequisites remain actionable policy blockers', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['host', 'update', 'apply', '--yes', '--json'], {
		interactiveUi: false,
		hostInvoke: async () => { throw Object.assign(new Error('Run `trsd host security initialize` and replay the accepted update.'), { status: 409, code: 'host_security_initialization_required' }); },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 1);
	assert.deepEqual(JSON.parse(output[0]!).error, {
		category: 'policy_blocked',
		code: 'host_security_initialization_required',
		message: 'Run `trsd host security initialize` and replay the accepted update.',
	});
});
