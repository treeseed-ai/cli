import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import test from 'node:test';
import {runCommandLine} from '../../../../src/cli/runtime.ts';
test('container startup and cleanup only invoke the protected manager, including failed-start cleanup',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'treeseed-managed-dev-'));
  try {
    const target={id:'service',kind:'live-api',platforms:['linux-amd64'],runtimeRequirements:[],sourceRoots:['src'],ignoredPaths:[],
      operations:{start:{command:'docker',args:['must-not-run'],environment:{},timeoutSeconds:10},cleanup:{command:'node',args:['-e','throw Error("unprivileged cleanup ran")'],environment:{},timeoutSeconds:10}},
      ready:{kind:'http',path:'/health',expectedStatus:200,timeoutSeconds:1},outputs:[],endpoints:[{id:'http',protocol:'http',port:3000,visibility:'host',canonicalAlias:'api.treeseed.localhost',authentication:'application'}],dependencies:[],statePolicy:'stateless',migrationPolicy:'none',secretRefs:{},
      shutdown:{graceSeconds:1,activeWorkPolicy:'block'},resources:{},logs:[],forbiddenOperations:[],promotion:{liveAdmissible:false,candidateRequiresVerification:true}};
    const runtime={schemaVersion:'treeseed.development-runtime/v1',project:{id:'api',repository:'treeseed-ai/api'},defaults:{leaseSeconds:600,restoreOnFailure:true},targets:[target]};
    const file=resolve(root,'treeseed.package.yaml');writeFileSync(file,JSON.stringify({development:runtime}));
    execFileSync('git',['init','-b','staging'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
    execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture'],{cwd:root});
    let record:any;const actions:string[]=[],records=new Map<string,any>();let selected='';
    const context={cwd:root,env:{XDG_STATE_HOME:resolve(root,'state'),USER:'tester'},interactiveUi:false,write:()=>{},hostInvoke:async(request:any)=>{
      const payload=JSON.parse(request.options.payload);
      if(request.handlerId==='local.dev.session.start'){record={session:payload.session,runtimes:payload.runtimes};records.set(payload.session.sessionId,record);return record;}
      record=records.get(payload.sessionId)??record;
      if(request.handlerId==='local.dev.environment')return {environment:{}};
      if(request.handlerId==='local.dev.container'){assert.equal(payload.sessionId,selected);actions.push(payload.action);return payload.action==='status'?{registered:false,state:null}:{};}
      if(request.handlerId==='local.dev.use'){
        if(payload.mode!=='released')assert.equal(payload.port,3000,'Every activation, including restart, must reattach the canonical route');
        record.session.targets[0].mode=payload.mode;
      }
      return record;
    }};
    assert.equal(await runCommandLine(['dev','session','start',file,'--json'],context),0);
    selected=record.session.sessionId;
    assert.equal(await runCommandLine(['dev','session','start',file,'--json'],context),0);
    assert.equal(await runCommandLine(['dev','use','api.service=live','--session',selected,'--json'],context),0);
    const beforePlan=[...actions];
    const planned:string[]=[];
    assert.equal(await runCommandLine(['dev','restart','api.service','--session',selected,'--plan','--json'],{...context,write:(value:string)=>planned.push(value)}),0);
    assert.deepEqual(actions,beforePlan,'Plan must not stop or start a container');
    assert.equal(record.session.targets[0].mode,'live','Plan must not switch routes');
    assert.equal(JSON.parse(planned[0]!).result.mutation,false);
    assert.equal(await runCommandLine(['dev','restart','api.service','--session',selected,'--json'],context),0);
    assert.equal(await runCommandLine(['dev','use','api.service=released','--session',selected,'--json'],context),0);
    assert.equal(await runCommandLine(['dev','session','stop','--session',selected,'--json'],context),0);
    assert.deepEqual(actions,['status','start','stop','start','stop','status']);
  } finally {rmSync(root,{recursive:true,force:true});}
});
