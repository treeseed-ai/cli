import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDevProcessAction } from '../../../src/cli/handlers/runtime/dev-lifecycle.ts';

test('a reset restarts selected local processes after disposable state is replaced', () => {
	assert.equal(resolveDevProcessAction({ subcommand: 'start', reset: true }), 'restart');
});

test('explicit restart and ordinary start preserve their lifecycle actions', () => {
	assert.equal(resolveDevProcessAction({ subcommand: 'restart', reset: false }), 'restart');
	assert.equal(resolveDevProcessAction({ subcommand: 'start', reset: false }), 'start');
});
