import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../src/cli/runtime.ts';

test('host security initialization prompts only for recovery custody', async () => {
	const calls: any[] = []; let prompts = 0;
	const exit = await runCommandLine(['host', 'security', 'initialize', '--recovery-bundle', '/tmp/recovery.bundle', '--confirm', '--json'], {
		interactiveUi: true, promptSecret: async () => { prompts += 1; return 'correct horse battery staple'; },
		hostInvoke: async (input) => { calls.push(input); return { verified: true }; }, write() {},
	});
	assert.equal(exit, 0); assert.equal(prompts, 2);
	assert.deepEqual(JSON.parse(calls[0].options.payload), { bundle: '/tmp/recovery.bundle', recoveryPassphrase: 'correct horse battery staple' });
});

test('provider credential initialization is discovered and sent through the protected generic boundary', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-provider-credential-')), codex = resolve(root, '.codex');
	const credential = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'private-token-value' } });
	const calls: any[] = [];
	try {
		mkdirSync(codex, { recursive: true }); writeFileSync(resolve(codex, 'auth.json'), credential);
		const initializer = { id: 'treeseed.codex', displayName: 'Codex adapter', description: 'Registered adapter credential.', sources: [
			{ id: 'chatgpt-subscription', label: 'Subscription', kind: 'file', prompt: 'Auth file', suggestedPaths: ['$HOME/.codex/auth.json'] },
		] };
		const exit = await runCommandLine(['host', 'provider', 'credentials', 'initialize', 'treeseed.codex', '--json'], {
			env: { HOME: root }, interactiveUi: false, hostInvoke: async (input) => { calls.push(input); return input.handlerId.endsWith('.list') ? { initializers: [initializer] } : { configured: true }; }, write() {},
		});
		assert.equal(exit, 0); assert.equal(calls.length, 2);
		assert.equal(calls[1].handlerId, 'local.host.provider.credentials.initialize');
		assert.deepEqual(JSON.parse(calls[1].options.payload), { sourceId: 'chatgpt-subscription', secret: credential });
	} finally { rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ['subscription-first', 'explicit-api-key', 'api-key-without-file']) test(`Codex supports both authentication modes: ${scenario}`, async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-credential-precedence-'));
	const subscription = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'synthetic-subscription' } });
	const calls: any[] = [], output: string[] = []; let prompts = 0;
	try {
		if (scenario !== 'api-key-without-file') {
			mkdirSync(resolve(root, '.codex')); writeFileSync(resolve(root, '.codex/auth.json'), subscription);
		}
		const initializer = { id: 'treeseed.codex', displayName: 'Codex', description: 'Registered credential', sources: [
			{ id: 'service-api-key', label: 'API key', kind: 'secret', prompt: 'API key', suggestedPaths: [] },
			{ id: 'chatgpt-subscription', label: 'Subscription', kind: 'file', prompt: 'Auth file', suggestedPaths: ['$HOME/.codex/auth.json'] },
		] };
		const exit = await runCommandLine(['host', 'provider', 'credentials', 'initialize', 'treeseed.codex', '--yes', '--json', ...(scenario === 'explicit-api-key' ? ['--source', 'service-api-key'] : [])], {
			env: { HOME: root }, interactiveUi: false, promptSecret: async () => { prompts++; return 'synthetic-api-key'; },
			hostInvoke: async input => { calls.push(input); return input.handlerId.endsWith('.list') ? { initializers: [initializer] } : { configured: true }; },
			write: value => output.push(value),
		});
		assert.equal(exit, 0);
		const useSubscription = scenario === 'subscription-first';
		assert.equal(prompts, useSubscription ? 0 : 1);
		assert.deepEqual(JSON.parse(calls[1].options.payload), { sourceId: useSubscription ? 'chatgpt-subscription' : 'service-api-key', secret: useSubscription ? subscription : 'synthetic-api-key' });
		assert.equal(output.join('').includes('synthetic-'), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
