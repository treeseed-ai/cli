import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependentDevelopmentAction } from '../../../../src/cli/commands/development-support/selection.ts';

test('source-coupled service consumers rebuild and restart', () => {
	const target = { kind: 'rebuild-restart', operations: { build: { command: 'npm', args: ['run', 'build'] } } } as const;
	assert.equal(dependentDevelopmentAction('rebuild', target as never), 'rebuild-restart');
});

test('dependency reactions preserve package and manual boundaries', () => {
	assert.equal(dependentDevelopmentAction('rebuild', { kind: 'package-watch', operations: { build: {} } } as never), 'package-rebuild');
	assert.equal(dependentDevelopmentAction('manual', { kind: 'rebuild-restart', operations: {} } as never), 'manual');
	assert.equal(dependentDevelopmentAction('restart', { kind: 'rebuild-restart', operations: { build: {} } } as never), 'restart');
});
