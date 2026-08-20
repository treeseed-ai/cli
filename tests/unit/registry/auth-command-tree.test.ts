import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCommandSpec, listCommandNames } from '../../../src/cli/support/registry.ts';
import { executeCommand } from '../../../src/cli/runtime/runtime.ts';
import { tokenFromSecretInput } from '../../../src/cli/handlers/accounts/auth.ts';

test('auth accepts a complete confirmation or reset link without exposing the token', () => {
	assert.equal(tokenFromSecretInput('https://local.test/auth/reset-password?token=secret-value&next=%2F'), 'secret-value');
	assert.equal(tokenFromSecretInput('  raw-secret-value  '), 'raw-secret-value');
});

test('auth is a discoverable command tree and colon commands are hidden compatibility entries', () => {
	const auth = findCommandSpec('auth');
	assert.equal(auth?.name, 'auth');
	assert.equal(auth?.handlerName, 'auth');
	assert.match(auth?.usage ?? '', /auth <register\|confirm-email\|login\|password-reset\|whoami\|logout>/u);
	assert.equal(findCommandSpec('auth:login')?.helpVisible, false);
	assert.equal(findCommandSpec('auth:logout')?.helpVisible, false);
	assert.equal(findCommandSpec('auth:whoami')?.helpVisible, false);
	assert.ok(listCommandNames().includes('auth'));
});

test('auth rejects command-line password and token options', async () => {
	const output: string[] = [];
	const exitCode = await executeCommand('auth', ['login', '--password', 'must-not-be-read'], {
		cwd: process.cwd(),
		env: process.env,
		write: (value) => output.push(value),
		spawn: () => ({ status: 0 }),
		outputFormat: 'human',
		interactiveUi: false,
	});
	assert.equal(exitCode, 1);
	assert.match(output.join('\n'), /Unknown option: --password/u);
	assert.doesNotMatch(output.join('\n'), /must-not-be-read/u);
});

test('auth secret-taking actions fail closed without an interactive TTY', async () => {
	const output: string[] = [];
	const previousFetch = globalThis.fetch;
	let fetched = false;
	globalThis.fetch = async () => {
		fetched = true;
		throw new Error('network must not be reached');
	};
	try {
		const exitCode = await executeCommand('auth', ['login', '--market', 'local', '--login', 'person@example.test', '--json'], {
			cwd: process.cwd(),
			env: { ...process.env, TREESEED_CONTROL_PLANE_MODE: 'managed', TREESEED_API_BASE_URL: 'http://127.0.0.1:3002' },
			write: (value) => output.push(value),
			spawn: () => ({ status: 0 }),
			outputFormat: 'json',
			interactiveUi: false,
		});
		assert.equal(exitCode, 1);
		assert.equal(fetched, false);
		assert.match(output.join('\n'), /interactive TTY/u);
		assert.doesNotMatch(output.join('\n'), /person@example\.test/u);
	} finally {
		globalThis.fetch = previousFetch;
	}
});
