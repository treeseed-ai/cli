import assert from 'node:assert/strict';
import test from 'node:test';
import { nextInteractiveRecipients, prepareInteractiveMessage, renderInteractiveChat, requiredCommunicationAddresses } from '../../../src/cli/communication/interactive-chat.ts';
import { runCommandLine } from '../../../src/cli/runtime.ts';

test('interactive chat requires a TTY when the send message is omitted', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['send', 'sdk-agent-tuning', '--team', 'team-1', '--json'], {
		interactiveUi: false, write: (value) => output.push(value),
	});
	assert.equal(exit, 1);
	assert.equal(JSON.parse(output[0]!).error.code, 'communication_interactive_tty_required');
});

test('send without a topic opens the same TTY-only topic browser boundary', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['send', '--team', 'team-1', '--json'], {
		interactiveUi: false, write: (value) => output.push(value),
	});
	assert.equal(exit, 1);
	assert.equal(JSON.parse(output[0]!).error.code, 'communication_interactive_tty_required');
});

test('sidebar recipients remain required and are combined with explicit address blocks', () => {
	assert.deepEqual(requiredCommunicationAddresses('@sdk/architect @api/architect\n\nHello'), ['@sdk/architect', '@api/architect']);
	assert.deepEqual(nextInteractiveRecipients('@sdk/architect\n\nHello', []), ['@sdk/architect']);
	assert.deepEqual(nextInteractiveRecipients('Continue with that design.', ['@sdk/architect']), ['@sdk/architect']);
	assert.deepEqual(nextInteractiveRecipients('@api/architect: Take over.', ['@sdk/architect']), ['@sdk/architect', '@api/architect']);
	assert.deepEqual(nextInteractiveRecipients('This incidental @api/reviewer mention is optional.', ['@sdk/architect']), ['@sdk/architect']);
	assert.deepEqual(prepareInteractiveMessage('Continue.', ['@sdk/architect']), { recipients: ['@sdk/architect'], message: '@sdk/architect\n\nContinue.' });
	assert.deepEqual(prepareInteractiveMessage('@api/architect: Compare.', ['@sdk/architect']), { recipients: ['@sdk/architect', '@api/architect'], message: '@sdk/architect\n\n@api/architect: Compare.' });
	assert.throws(() => nextInteractiveRecipients('No initial recipient.', []), /first interactive message/u);
});

test('incoming timeline rendering preserves a multiline composer and strong response separation', () => {
	const rendered = renderInteractiveChat({ channel: 'sdk-agent-tuning', recipients: ['@sdk/architect'], composer: 'draft line one\ndraft line two', status: 'Connected.', diagnostics: false, scroll: 0,
		lines: [{ key: 'event-1', heading: '@sdk/architect   10:30 PM', body: 'A long agent response.', kind: 'response' }] }, 80, 24);
	assert.match(rendered, /@sdk\/architect   10:30 PM/u);
	assert.match(rendered, /═{80}/u);
	assert.match(rendered, /› draft line one\n  draft line two/u);
});
