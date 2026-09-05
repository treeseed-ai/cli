import assert from 'node:assert/strict';
import test from 'node:test';
import { runServiceCredentials } from '../../../../src/cli/commands/services/credentials.ts';
const invocation=(name:string,options:Record<string,any>={})=>({command:{name:`services credentials ${name}`,path:['services','credentials',name]},arguments:['connection-1','railway-workspace'],options:{team:'team-1','expected-version':'0',...options}} as any);
const context=(operationInvoke:any)=>({cwd:'.',env:{},write(){},outputFormat:'json' as const,interactiveUi:false,operationInvoke});
test('puts stdin credentials with exact CAS and returns metadata only',async()=>{
  let recorded:any;
  const output=await runServiceCredentials(invocation('put',{stdin:true}),{...context(async(id:any,input:any,options:any)=>{
    recorded=structuredClone({id,input,options});return{data:{custody:'openbao',version:1,configured:true,fields:['apiToken']}};
  }),readStdin:()=>JSON.stringify({apiToken:'synthetic-secret'})});
  assert.equal(recorded.id,'services.credentials.put');
  assert.deepEqual(recorded.input.body,{expectedVersion:0,values:{apiToken:'synthetic-secret'}});
  assert.match(recorded.options.idempotencyKey,/^[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(output).includes('synthetic-secret'),false);
});
test('plan never requests or transmits secrets',async()=>{
  const output=await runServiceCredentials(invocation('put',{plan:true,stdin:true}),{...context(()=>{throw Error('unexpected request');}),readStdin:()=>{throw Error('unexpected secret input');}});
  assert.equal(output.mutation,false);
});
test('rejects malformed secret input without echoing it or calling API',async()=>{
  await assert.rejects(runServiceCredentials(invocation('put',{stdin:true}),{...context(()=>{throw Error('unexpected request');}),readStdin:()=>'{synthetic-secret'}),error=>{
    assert.equal(String(error).includes('synthetic-secret'),false);return true;
  });
});
