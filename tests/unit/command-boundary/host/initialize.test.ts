import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { hostUsesProtectedLocalTransport } from '../../../../src/cli/commands/host.ts';

test('host initialize plan requests no runtime values', async () => {
	const calls: any[] = []; let prompts = 0;
	const exit = await runCommandLine(['host', 'initialize', '--profile', 'capacity-provider', '--plan', '--json'], {
		interactiveUi: false, prompt: async () => { prompts += 1; return 'never'; }, promptSecret: async () => { prompts += 1; return 'never'; },
		hostInvoke: async (request) => { calls.push(request); return { profile: 'capacity-provider', inputs: [{ name: 'teamRegistrationCode', required: true, sensitive: true, description: 'Registration code' }] }; }, write() {},
	});
	assert.equal(exit, 0); assert.equal(prompts, 0);
	assert.deepEqual(calls, [{ handlerId: 'local.host.initialize', arguments: [], options: { plan: true, profile: 'capacity-provider' } }]);
	assert.equal(hostUsesProtectedLocalTransport({ command: { name: 'host initialize' } as any }), true);
});

test('host initialize prompts from the manager plan and keeps secrets out of argv and output', async () => {
	const secret = 'registration-code-private'; const calls: any[] = []; const output: string[] = [];
	const exit = await runCommandLine(['host', 'initialize', '--profile', 'capacity-provider', '--confirm', '--yes', '--json'], {
		interactiveUi: false, prompt: async () => 'https://api.example.test', promptSecret: async () => secret,
		hostInvoke: async (request) => {
			calls.push(request);
			if (request.options.plan === true) return { hostId: 'provider-01', catalog: { release: '0.1.0~rc200', generation: 160, digest: `sha256:${'a'.repeat(64)}` }, inputs: [
				{ name: 'controlPlaneUrl', required: true, sensitive: false, description: 'Control plane URL' },
				{ name: 'teamRegistrationCode', required: true, sensitive: true, description: 'Team registration code' },
			] };
			return { state: 'pending-approval', profile: 'capacity-provider' };
		}, write: (value) => output.push(value),
	});
	assert.equal(exit, 0); assert.equal(calls.length, 2);
	assert.deepEqual(calls[0], { handlerId: 'local.host.initialize', arguments: [], options: { plan: true, profile: 'capacity-provider' } });
	assert.deepEqual(JSON.parse(calls[1].options.payload), { profile: 'capacity-provider', hostId: 'provider-01',
		catalog: { release: '0.1.0~rc200', generation: 160, digest: `sha256:${'a'.repeat(64)}` },
		inputs: { controlPlaneUrl: 'https://api.example.test', teamRegistrationCode: secret } });
	assert.equal(JSON.stringify(output).includes(secret), false);
});

test('host initialize rejects a missing immutable plan binding before prompting', async () => {
	let prompts = 0; let calls = 0;
	const exit = await runCommandLine(['host', 'initialize', '--profile', 'core', '--confirm', '--yes', '--json'], {
		interactiveUi: false, prompt: async () => { prompts += 1; return ''; }, promptSecret: async () => { prompts += 1; return ''; },
		hostInvoke: async () => { calls += 1; return { hostId: 'runtime-host', inputs: [] }; }, write() {},
	});
	assert.equal(exit, 1); assert.equal(calls, 1); assert.equal(prompts, 0);
});

test('host initialize rejects incomplete execution confirmation before manager invocation', async () => {
	for (const argv of [['host', 'initialize', '--profile', 'core', '--confirm', '--json'], ['host', 'initialize', '--profile', 'core', '--yes', '--json']]) {
		let calls = 0; const output: string[] = [];
		const exit = await runCommandLine(argv, { interactiveUi: false, hostInvoke: async () => { calls += 1; }, write: (value) => output.push(value) });
		assert.equal(exit, 1); assert.equal(calls, 0); assert.equal(JSON.parse(output[0]!).error.category, 'confirmation_required');
	}
});
