import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProjectSelector } from '../../../../src/cli/support/selectors/project.ts';

test('project selectors preserve exact IDs and resolve a team-scoped slug', async () => {
	const id = '8cbfb810-6da5-4da2-9ae9-cad53101253f';
	assert.equal(await resolveProjectSelector(id, undefined, async () => { throw new Error('unexpected read'); }), id);
	assert.equal(await resolveProjectSelector('sdk', 'team-a', async () => ({
		items: [
			{ id, slug: 'sdk', teamId: 'team-a' },
			{ id: 'other', slug: 'sdk', teamId: 'team-b' },
		],
	})), id);
});

test('project selectors reject missing and ambiguous slugs', async () => {
	await assert.rejects(resolveProjectSelector('missing', undefined, async () => ({ items: [] })), { code: 'project_not_found' });
	await assert.rejects(resolveProjectSelector('sdk', undefined, async () => ({
		items: [{ id: 'one', slug: 'sdk' }, { id: 'two', slug: 'sdk' }],
	})), { code: 'project_ambiguous' });
});
