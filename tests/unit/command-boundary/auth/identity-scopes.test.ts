import assert from 'node:assert/strict';
import test from 'node:test';
import { identityLogin, IDENTITY_SCOPES, requestedIdentityScopes, grantedIdentityScopes } from '../../../../src/cli/support/identity-login.ts';
import { createCommandContext } from '../../../../src/cli/runtime.ts';
import { identityFixture, apiResource } from '../../../support/identity-fixture.ts';

test('additional scopes are explicit, bounded and deduplicated', () => {
	assert.deepEqual(requestedIdentityScopes(undefined), IDENTITY_SCOPES);
	assert.deepEqual(requestedIdentityScopes('treeseed:admin, treeseed:read'), [...IDENTITY_SCOPES, 'treeseed:admin']);
	for (const value of ['', 'treeseed:admin,', 'bad scope', 42]) assert.throws(() => requestedIdentityScopes(value));
	assert.throws(() => grantedIdentityScopes(['treeseed:admin'], 'treeseed:read'));
	assert.deepEqual(grantedIdentityScopes(['treeseed:read'], undefined), ['treeseed:read']);
});

for (const device of [false, true]) test(`explicit admin scope uses normal ${device ? 'device' : 'PKCE'} authorization`, async context => {
	const scopes = [...IDENTITY_SCOPES, 'treeseed:admin'];
	const fixture = await identityFixture({ scopes }), realFetch = globalThis.fetch;
	context.mock.method(globalThis, 'fetch', fixture.transport);
	const result = await identityLogin({ resource: apiResource, scopes, device, timeoutSeconds: 10 }, createCommandContext({
		write: () => {}, openExternal: async url => {
			if (!device) assert.equal((await realFetch(fixture.authorize(url))).status, 200);
			return true;
		},
	}));
	assert.ok(fixture.state.requestedScopes.includes('treeseed:admin'));
	assert.deepEqual(grantedIdentityScopes(scopes, result.tokens.scope), scopes);
});

test('unadvertised scope is rejected before authorization starts', async context => {
	const fixture = await identityFixture();
	context.mock.method(globalThis, 'fetch', fixture.transport);
	let opened = false;
	await assert.rejects(identityLogin({ resource: apiResource, scopes: ['treeseed:admin'], device: false, timeoutSeconds: 10 },
		createCommandContext({ openExternal: async () => { opened = true; return true; } })), /does not advertise/);
	assert.equal(opened, false); assert.equal(fixture.state.tokenCalls, 0);
});
