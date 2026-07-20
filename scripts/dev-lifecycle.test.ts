import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTreeseedDevProcessAction } from '../src/cli/handlers/dev-lifecycle.ts';

test('a reset restarts selected local processes after disposable state is replaced', () => {
	assert.equal(resolveTreeseedDevProcessAction({ subcommand: 'start', reset: true }), 'restart');
});

test('explicit restart and ordinary start preserve their lifecycle actions', () => {
	assert.equal(resolveTreeseedDevProcessAction({ subcommand: 'restart', reset: false }), 'restart');
	assert.equal(resolveTreeseedDevProcessAction({ subcommand: 'start', reset: false }), 'start');
});
