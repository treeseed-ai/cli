import assert from 'node:assert/strict';
import test from 'node:test';
import { cellWidth, fixedSidebarLayout, highlightedMarkdown, stableSelection, topicSlug, truncateCells, workbenchLayout } from '../../../src/cli/tui/index.ts';
import { chatTranscriptMarkdown, eventLine } from '../../../src/cli/communication/interactive-chat.ts';

test('workbench geometry follows the wide wireframe and converts panes to tabs below 112 columns', () => {
	const wide = workbenchLayout(160, 50, .7);
	assert.equal(wide.narrow, false);
	assert.ok(wide.left > 0 && wide.main > 0 && wide.right > 0);
	assert.equal(wide.left + wide.main + wide.right + 2, 160);
	assert.equal(workbenchLayout(112, 30, .7).narrow, false);
	const compact = workbenchLayout(111, 30, .7);
	assert.equal(compact.narrow, true);
	assert.equal(compact.right, 0);
	const minimum = workbenchLayout(72, 22, .7);
	assert.ok(minimum.main > 0 && minimum.top > 0 && minimum.bottom > 0);
});

test('right sidebar geometry remains fixed when the center splitter moves', () => {
	const body = workbenchLayout(160, 50, .7).body;
	const sidebar = fixedSidebarLayout(body, 9);
	assert.deepEqual(fixedSidebarLayout(workbenchLayout(160, 50, .4).body, 9), sidebar);
	assert.equal(sidebar.top + sidebar.bottom + 1, body);
});

test('shared text controls respect terminal cell width and highlight Markdown structure', () => {
	const clipped = truncateCells('agents 🌳 漢字 discussion', 12);
	assert.ok(cellWidth(clipped) <= 12);
	const markdown = highlightedMarkdown('# Heading\n`code`\n```ts\nconst x = 1\n```', true);
	assert.match(markdown, /1 │/u);
	assert.match(markdown, /Heading/u);
	assert.match(markdown, /const x = 1/u);
});

test('shared stable selection and topic normalization preserve identity', () => {
	assert.equal(stableSelection([{ id: 'a' }, { id: 'b' }], 'b'), 'b');
	assert.equal(stableSelection([{ id: 'a' }], 'missing'), 'a');
	assert.equal(topicSlug('  SDK Agent Tuning!  '), 'sdk-agent-tuning');
	assert.equal(topicSlug('x'.repeat(90)).length, 72);
	assert.throws(() => topicSlug('---'), /letter or number/u);
});

test('chat lifecycle events and transcript export retain public discussion evidence', () => {
	const response = eventLine({ id: 'event-1', type: 'agent.response', occurredAt: '2026-08-29T02:18:02.099Z', actor: { handle: '@sdk/architect' }, payload: { markdown: '**Ready.**' } }, false);
	assert.ok(response);
	const transcript = chatTranscriptMarkdown('sdk-agent-tuning', [response!], ['@sdk/architect'], '2026-08-29T03:00:00.000Z');
	assert.match(transcript, /# TreeSeed Discussion: sdk-agent-tuning/u);
	assert.match(transcript, /@sdk\/architect/u);
	assert.match(transcript, /\*\*Ready\.\*\*/u);
	assert.doesNotMatch(transcript, /diagnostic|system prompt|tool result/iu);
});
