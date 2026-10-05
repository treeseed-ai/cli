import assert from 'node:assert/strict';
import test from 'node:test';
import { completeHostedTopologyOperation } from '../../../../src/cli/commands/platform/hosted-operation.ts';
const context = {cwd:'.',env:{},write(){},outputFormat:'json' as const,interactiveUi:false,
  readStdin(){throw new Error('Must not request a passphrase');},promptSecret(){throw new Error('Must not request credentials');}};
test('hosted operations consume only authorized status, without client-vault interaction', async () => {
  const calls: string[] = [];
  const result = await completeHostedTopologyOperation({operation:{id:'operation-1'}},'team-1',async (operation,input) => {
    calls.push(operation.descriptor.operationId);
    assert.deepEqual(input,{path:{operationId:'operation-1'},query:{},body:undefined});
    return {data:{status:'completed',output:{plan:{planDigest:'digest'}}}};
  },context);
  assert.deepEqual(result,{planDigest:'digest'}); assert.deepEqual(calls,['operations.show']);
});
test('operation errors do not expose arbitrary runner diagnostics', async () => {
  await assert.rejects(completeHostedTopologyOperation({operation:{id:'operation-1'}},'team-1',
    async () => ({data:{status:'failed',error:{message:'sensitive-provider-value'}}}),context), error => {
    assert.equal(String(error).includes('sensitive-provider-value'),false); return true;
  });
});
