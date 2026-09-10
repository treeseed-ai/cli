import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTeamSelector } from '../../../src/cli/support/team-selector.ts';
import { runCommandLine } from '../../../src/cli/runtime.ts';
const id = '11111111-1111-4111-8111-111111111111';
test('exact IDs do not require inventory and unknown slugs fail closed', async () => {
  assert.equal(await resolveTeamSelector(id, async () => {throw new Error('unexpected read');}), id);
  await assert.rejects(resolveTeamSelector('missing', async () => ({items:[]})), {code:'team_not_found'});
});
test('slug lookup scans pages and rejects ambiguous or incomplete inventory', async () => {
  const read = async (cursor?: string) => cursor ? {items:[{id,slug:'TreeSeed'}]} : {items:[],page:{hasMore:true,nextCursor:'two'}};
  assert.equal(await resolveTeamSelector('treeseed',read),id);
  await assert.rejects(resolveTeamSelector('treeseed',async () => ({items:[{id,slug:'treeseed'},{id:'another',slug:'treeseed'}]})),{code:'team_ambiguous'});
  await assert.rejects(resolveTeamSelector('treeseed',async () => ({items:[{id,slug:'treeseed'}],page:{hasMore:true,nextCursor:'loop'}})),/pagination/);
});
for (const args of [['send','acceptance','@sdk/architect Hi'],['providers','connect']]) test(`${args[0]} plan resolves the team without executing the operation`,async () => {
  const output: string[] = [], calls: string[] = [];
  const exit = await runCommandLine([...args,'--team','treeseed','--plan','--json'],{interactiveUi:false,operationInvoke:async operation => {
    calls.push(operation); assert.equal(operation,'teams.list'); return {data:{items:[{id,slug:'treeseed'}]}};
  },write:value=>output.push(value)});
  assert.equal(exit,0,output.join('\n')); assert.deepEqual(calls,['teams.list']);
  assert.equal(JSON.parse(output[0]!).result.input.path.teamId,id);
});
