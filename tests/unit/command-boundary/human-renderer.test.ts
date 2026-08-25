import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandResult } from '@treeseed/sdk/operator-contracts';
import { renderHumanCommandResult } from '../../../src/cli/support/human-renderer.ts';

test('human login output is concise and contains no command envelope JSON', () => {
	const output = renderHumanCommandResult(createCommandResult({ commandPath: ['auth', 'login'], mode: 'execute', ok: true,
		result: { serverId: 'local', principal: { id: 'user-a', displayName: 'Adrian Webb' }, expiresAt: '2027-01-01T00:00:00.000Z', scopes: ['treeseed:read'] },
		error: null, warnings: [], blockers: [], receipts: [], nextActions: [] }));
	assert.match(output, /Logged in to local as Adrian Webb\./u);
	assert.match(output, /Scopes: treeseed:read/u);
	assert.doesNotMatch(output, /schemaVersion|commandPath|[{}]/u);
});

test('generic human output renders labels and values without JSON punctuation', () => {
	const output = renderHumanCommandResult({ commandPath: ['seeds', 'verify'], ok: true,
		result: { seedName: 'treeseed', verified: true, lanes: ['communication', 'platform', 'workday'] }, warnings: [], nextActions: [] });
	assert.equal(output, 'Seed Name: treeseed\nVerified: yes\nLanes: communication, platform, workday');
	assert.doesNotMatch(output, /[{}]/u);
});

test('communication responses render as Markdown panels without an envelope dump', () => {
	const output = renderHumanCommandResult({ commandPath: ['send'], ok: true, result: {
		channel: 'engineering', status: 'complete', sendId: 'send-1', sourceMessage: '@architect Please advise.',
		projectStream: { projectSlug: 'sdk' }, targets: [{ agentSlug: 'architect' }],
		responses: [{ projectId: 'sdk', agentSlug: 'architect', requirement: 'required', status: 'responded', markdown: '## Direction\n\nUse **one catalog**.' }],
	} });
	assert.match(output, /Topic engineering · sdk · complete · 1\/1 outcomes/u);
	assert.match(output, /┌─ @sdk\/architect · required · responded/u);
	assert.match(output, /## Direction/u);
	assert.doesNotMatch(output, /schemaVersion|commandPath|"responses"/u);
});
