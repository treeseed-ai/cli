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

test('communication responses render as separated Markdown messages without redundant state', () => {
	const output = renderHumanCommandResult({ commandPath: ['send'], ok: true, result: {
		channel: 'engineering', status: 'complete', sendId: 'send-1',
		projectStreams: [{ projectId: 'project-sdk', projectSlug: 'sdk' }],
		targets: [{ projectId: 'project-sdk', projectSlug: 'sdk', agentSlug: 'architect' }],
		responses: [{ projectId: 'project-sdk', projectSlug: 'sdk', agentSlug: 'architect', requirement: 'required', status: 'responded',
			createdAt: '2026-08-29T02:18:02.099Z', markdown: '## Direction\n\nUse **one catalog**.' }],
	} });
	assert.match(output, /@sdk\/architect/u);
	assert.match(output, /═{48}/u);
	assert.match(output, /## Direction/u);
	assert.doesNotMatch(output, /schemaVersion|commandPath|"responses"|required|responded|@architect Please advise|[┌┐└┘│]/u);
});
