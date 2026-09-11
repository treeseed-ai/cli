import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createControlPlaneClient } from '../../../../src/cli/support/client.ts';
import { loadServerSession, saveServerProfile, saveServerSession } from '../../../../src/cli/support/server-custody.ts';
import type { CommandContext } from '../../../../src/cli/types.ts';
import { apiResource, identityFixture, sessionBinding } from '../../../support/identity-fixture.ts';

for (const rejectRenewal of [false,true]) test(`concurrent Identity renewal is single-use and invalidates ambiguity (${rejectRenewal})`, async context => {
	const fixture = await identityFixture(); fixture.state.rejectRenewal = rejectRenewal;
	context.mock.method(globalThis,'fetch',fixture.transport);
	const root = mkdtempSync(join(tmpdir(),'treeseed-cli-renewal-'));
	const env = {TREESEED_CONFIG_HOME:root};
	const commandContext:CommandContext = {cwd:root,env,write:()=>{},outputFormat:'json',interactiveUi:false};
	try {
		saveServerProfile({serverId:'test',label:'Test',baseUrl:apiResource},env);
		await saveServerSession({...sessionBinding,serverId:'test',audience:apiResource,accessToken:'expired',refreshToken:'old',expiresAt:'2020-01-01T00:00:00.000Z'},env);
		const results = await Promise.allSettled([1,2].map(()=>createControlPlaneClient({options:{server:'test'}},commandContext,true,true)));
		assert.equal(fixture.state.tokenCalls,1);
		assert.ok(results.every(result=>result.status === (rejectRenewal ? 'rejected':'fulfilled')));
		assert.equal(loadServerSession('test',env)?.refreshToken ?? null,rejectRenewal ? null:'rotated');
	} finally {rmSync(root,{recursive:true,force:true});}
});

test('changed subject fails renewal and old unbound sessions require fresh sign-in',async context=>{
	const fixture = await identityFixture(); fixture.state.subject = 'other';
	context.mock.method(globalThis,'fetch',fixture.transport);
	const root = mkdtempSync(join(tmpdir(),'treeseed-cli-binding-')), env={TREESEED_CONFIG_HOME:root};
	const commandContext:CommandContext={cwd:root,env,write:()=>{},outputFormat:'json',interactiveUi:false};
	try {
		saveServerProfile({serverId:'test',label:'Test',baseUrl:apiResource},env);
		await saveServerSession({...sessionBinding,serverId:'test',audience:apiResource,accessToken:'old',refreshToken:'old',expiresAt:'2020-01-01T00:00:00.000Z'},env);
		await assert.rejects(createControlPlaneClient({options:{server:'test'}},commandContext));
		assert.equal(loadServerSession('test',env),null);
		await saveServerSession({...sessionBinding,identity:undefined as never,serverId:'test',audience:apiResource,accessToken:'old'},env);
		await assert.rejects(createControlPlaneClient({options:{server:'test'}},commandContext),{code:'identity_login_required'});
		assert.equal(fixture.state.tokenCalls,1);
	} finally {rmSync(root,{recursive:true,force:true});}
});
