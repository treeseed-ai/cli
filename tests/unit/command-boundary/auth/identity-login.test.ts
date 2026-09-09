import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { loadServerSession, saveServerProfile } from '../../../../src/cli/support/server-custody.ts';
import { apiResource, identityFixture, identityIssuer } from '../../../support/identity-fixture.ts';

for (const device of [false,true]) test(`identity ${device ? 'device':'browser PKCE'} login stores only encrypted resource-bound credentials`,async context=>{
	const fixture=await identityFixture(), realFetch=globalThis.fetch;
	context.mock.method(globalThis,'fetch',fixture.transport);
	const root=mkdtempSync(join(tmpdir(),'treeseed-cli-login-')),env={TREESEED_CONFIG_HOME:root};
	const output:Array<{value:string;stream?:string}>=[];
	try {
		saveServerProfile({serverId:'test',label:'Test',baseUrl:apiResource},env);
		const exit=await runCommandLine(['auth','login','--server','test','--json',...(device ? ['--device']:[])],{
			env,interactiveUi:false,write:(value,stream)=>output.push({value,stream}),
			openExternal:async url=>{
				if (!device) {const callback=fixture.authorize(url);const response=await realFetch(callback);assert.equal(response.status,200);}
				return true;
			},
		});
		assert.equal(exit,0,JSON.stringify(output));
		const session=loadServerSession('test',env)!;
		assert.deepEqual(session.identity,{issuer:identityIssuer,subject:'subject'});
		assert.equal(session.principal?.id,'local-user');assert.equal(session.audience,apiResource);
		const stdout=output.filter(item=>item.stream!=='stderr').map(item=>item.value).join('');
		assert.equal(JSON.parse(stdout).ok,true);
		for (const secret of [session.accessToken,session.refreshToken!,'private-device']) assert.equal(JSON.stringify(output).includes(secret),false);
		assert.match(output.filter(item=>item.stream==='stderr').map(item=>item.value).join(''),/Opened your browser/);
		output.length=0;
		assert.equal(await runCommandLine(['auth','logout','--server','test','--json'],{env,interactiveUi:false,write:(value,stream)=>output.push({value,stream})}),0);
		assert.equal(loadServerSession('test',env),null);
		assert.equal(JSON.parse(output[0]!.value).result.upstreamRevoked,true);
	} finally {rmSync(root,{recursive:true,force:true});}
});
