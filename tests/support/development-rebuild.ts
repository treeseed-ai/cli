import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import type {DevelopmentRuntime, DevelopmentSession, DevelopmentTarget} from '@treeseed/sdk/development';
import {runCommandLine} from '../../src/cli/runtime.ts';
import type {CommandContext} from '../../src/cli/types.ts';

export function rebuildTarget(managerOwned=false):DevelopmentTarget {
 return {id:'worker',kind:'rebuild-restart',executionCustody:managerOwned?'manager':'caller',platforms:['linux-amd64'],runtimeRequirements:['node>=22'],sourceRoots:['scripts'],ignoredPaths:['build.log','candidate.bin'],
  operations:{build:{command:process.execPath,args:['--import',import.meta.resolve('tsx'),'scripts/build.ts'],environment:{},timeoutSeconds:10},start:{command:managerOwned?'manager-runtime':'docker',args:['fixture-only'],environment:{},timeoutSeconds:10}},
  ready:{kind:'process',graceSeconds:0},outputs:[],endpoints:[],dependencies:[],statePolicy:'stateless',migrationPolicy:'none',secretRefs:{},shutdown:{graceSeconds:1,activeWorkPolicy:'block'},resources:{},logs:[],forbiddenOperations:[],promotion:{liveAdmissible:false,candidateRequiresVerification:true}};
}

export async function rebuildFixture(options:{managerOwned?:boolean;failAt?:number;rejectStop?:boolean;rejectStart?:boolean;missingBuild?:boolean;rejectRefresh?:boolean}={}) {
 const root=mkdtempSync(resolve(tmpdir(),'cli-rebuild-source-')),state=mkdtempSync(resolve(tmpdir(),'cli-rebuild-state-'));
 const target=rebuildTarget(options.managerOwned);
 if(options.missingBuild)delete target.operations.build;
 else target.operations.build!.environment={FAIL_AT:String(options.failAt??0)};
 const runtime:DevelopmentRuntime={schemaVersion:'treeseed.development-runtime/v2',project:{id:'specimen',repository:'example/specimen'},defaults:{restoreOnFailure:true},targets:[target]};
 const file=resolve(root,'treeseed.package.yaml');
 writeFileSync(file,JSON.stringify({development:runtime}));mkdirSync(resolve(root,'scripts'));
 writeFileSync(resolve(root,'scripts/build.ts'),"import {existsSync,readFileSync,appendFileSync,writeFileSync} from 'node:fs';const n=(existsSync('build.log')?readFileSync('build.log','utf8').trim().split('\\n').length:0)+1;appendFileSync('build.log',`${n}\\n`);if(n===Number(process.env.FAIL_AT))process.exit(7);writeFileSync('candidate.bin',`built-${n}`);\n");
 writeFileSync(resolve(root,'.gitignore'),'build.log\ncandidate.bin\n');
 const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});
 git('init','-b','staging');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
 let record:{session:DevelopmentSession;runtimes:DevelopmentRuntime[]};const calls:string[]=[],output:string[]=[],selectedBytes:string[]=[],selections:string[]=[];
 const uses:Array<{mode:string;port?:number}>=[];
 const context:CommandContext={cwd:root,env:{...process.env,XDG_STATE_HOME:state},interactiveUi:false,outputFormat:'json',write:value=>output.push(value),hostInvoke:async input=>{
  const payload=JSON.parse(String(input.options.payload));calls.push(input.handlerId+(payload.action?`:${payload.action}`:''));
  if(input.handlerId==='local.dev.session.start'){record={session:payload.session,runtimes:structuredClone(payload.runtimes)};return record;}
  if(input.handlerId==='local.dev.session.refresh'){
   if(options.rejectRefresh)throw new Error('Fixture refuses runtime refresh.');
   record.runtimes=structuredClone(payload.runtimes);return record;
  }
  if(input.handlerId==='local.dev.environment')return {environment:{}};
  if(input.handlerId==='local.dev.container'){
   if(payload.action==='stop'&&options.rejectStop)throw new Error('Fixture active claim refuses stop.');
   if(payload.action==='start'){
    // The owning start boundary performs its drain/active-claim check before
    // replacing a selection; refusal must not require an explicit release.
    if(options.rejectStop)throw new Error('Fixture active claim refuses stop.');
    if(options.rejectStart)throw new Error('Fixture owning handoff refuses active custody.');
    selectedBytes.push(existsSync(resolve(root,'candidate.bin'))?readFileSync(resolve(root,'candidate.bin'),'utf8'):'manager-owned');
   }
   return {};
  }
  if(input.handlerId==='local.dev.use'){uses.push(payload);selections.push(payload.mode);record.session.targets[0]!.mode=payload.mode;return record;}
  if(input.handlerId==='local.dev.status'||input.handlerId==='local.dev.rebuild')return record;
  throw new Error(`Unexpected fixture boundary ${input.handlerId}`);
 }};
 try {
  assert.equal(await runCommandLine(['dev','session','start',file,'--json'],context),0,output.join(''));
  record!.session.targets[0]!.mode='candidate';calls.length=0;output.length=0;selections.length=0;
 }catch(error){rmSync(root,{recursive:true,force:true});rmSync(state,{recursive:true,force:true});throw error;}
 return {root,calls,output,selectedBytes,selections,uses,managerRuntimes:()=>structuredClone(record.runtimes),
  invoke:(command='rebuild',plan=false)=>runCommandLine(['dev',command,'specimen.worker',...(plan?['--plan']:[]),'--json'],context),
  builds:()=>existsSync(resolve(root,'build.log'))?readFileSync(resolve(root,'build.log'),'utf8').trim().split('\n'):[],
  mode:()=>record.session.targets[0]!.mode,
  close(){rmSync(root,{recursive:true,force:true});rmSync(state,{recursive:true,force:true});}};
}
