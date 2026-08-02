import assert from 'node:assert/strict';
import test from 'node:test';
import { contentOperationSpecs } from '../../../src/cli/content/operations-content.ts';

test('content sync exposes one fail-closed plan/live command', () => {
	assert.equal(contentOperationSpecs.length, 1);
	const [operation] = contentOperationSpecs;
	assert.equal(operation.id, 'content.sync');
	assert.equal(operation.handlerName, 'content');
	assert.match(operation.usage, /content sync --project/u);
	assert.deepEqual(
		operation.options?.map(({ name }) => name),
		['market', 'project', 'branch', 'path', 'plan', 'json'],
	);
	assert.equal(operation.options?.some(({ name }) => name === 'force'), false);
	assert.equal(operation.notes?.some((note) => note.includes('fast-forwards only')), true);
	assert.equal(operation.notes?.some((note) => note.includes('no local work is discarded')), true);
});
