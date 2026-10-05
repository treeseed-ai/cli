import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { loadServerSession, saveServerSession, saveServerProfile } from '../../../../src/cli/support/server-custody.ts';
import { apiResource, identityFixture, identityIssuer } from '../../../support/identity-fixture.ts';

for (const failure of ['resource', 'issuer', 'refresh'] as const) test(`renewal ${failure} failure invalidates only after refresh starts`, async context => {
  const fixture = await identityFixture(); fixture.state.rejectRenewal = true;
  context.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if ((failure === 'resource' && url.includes('oauth-protected-resource')) || (failure === 'issuer' && url.includes('openid-configuration'))) return new Response('Unavailable', { status: 502 });
    return fixture.transport(input, init);
  });
  const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-renewal-')), env = { TREESEED_CONFIG_HOME: root };
  const output: string[] = [];
  try {
    saveServerProfile({ serverId: 'test', label: 'Test', baseUrl: apiResource }, env);
    await saveServerSession({ serverId: 'test', audience: apiResource, identity: { issuer: identityIssuer, subject: 'subject' }, clientId: 'trsd', scopes: ['openid'],
      accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: '2020-01-01T00:00:00.000Z', activeTeam: { id: 'team', slug: 'team', name: 'Team' } }, env);
    const before = loadServerSession('test', env);
    const exit = await runCommandLine(['auth', 'status', '--server', 'test', '--json'], { env, interactiveUi: false, write: value => output.push(value) });
    assert.notEqual(exit, 0);
    if (failure === 'refresh') { assert.equal(fixture.state.tokenCalls, 1); assert.equal(loadServerSession('test', env), null); }
    else { assert.equal(fixture.state.tokenCalls, 0); assert.deepEqual(loadServerSession('test', env), before); }
    assert.equal(output.join('').includes('synthetic-refresh'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
