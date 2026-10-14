import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

test('packaged native development status reads the complete manager inventory over the protected local socket without local state and preserves denial interruption and exact retry', { timeout: 30_000 }, async context => {
 const root=mkdtempSync(resolve(tmpdir(),'cli-development-status-')),entrypoint=resolve(JSON.parse(readFileSync('package.json','utf8')).bin.trsd),entryBytes=readFileSync(entrypoint);
 let child:ChildProcess|undefined,mode:'accept'|'denied'|'malformed'|'interrupted'='accept';
 const requests:Array<{method:string|undefined;path:string|undefined;payload:unknown}>=[];
 const inventory={sessions:[{session:{sessionId:'dev-other',targets:[{projectId:'project',targetId:'service',mode:'live',generation:4}]},candidates:[]}]};
 const frozen=structuredClone(inventory),failures:Array<{code:number|null;stdout:string;stderr:string}>=[];
 const socket='/run/treeseed/manager/api.sock';assert.equal(existsSync(socket),false,'Native CI must preserve any unrelated manager socket');
 const server=createServer((request,response)=>{
  let body='';request.setEncoding('utf8');request.on('data',bytes=>{body+=String(bytes);});request.on('end',()=>{
   requests.push({method:request.method,path:request.url,payload:JSON.parse(body)});
   if(mode==='interrupted'){request.socket.destroy();return;}
   response.setHeader('content-type','application/json');
   if(mode==='malformed'){response.end('{');return;}
   if(mode==='denied'){response.writeHead(403).end(JSON.stringify({ok:false,data:null,error:{code:'native_manager_denied',message:'Original native manager denial'}}));return;}
   response.end(JSON.stringify({ok:true,data:inventory,error:null}));
  });
 });
 try{
  await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(socket,accept);});
  const env={...process.env,XDG_STATE_HOME:resolve(root,'state'),XDG_CONFIG_HOME:resolve(root,'config'),TREESEED_CONFIG_HOME:resolve(root,'config')};
  const execute=async(args:string[])=>{
   const original=[...args],offset=requests.length;child=spawn(process.execPath,[entrypoint,'dev','status',...args,'--json'],{env,signal:context.signal,stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';child.stdout!.on('data',value=>{stdout+=String(value);});child.stderr!.on('data',value=>{stderr+=String(value);});
   const code=await new Promise<number|null>((accept,reject)=>{child!.once('error',reject);child!.once('close',accept);});assert.deepEqual(args,original);
   assert.deepEqual(requests.slice(offset),[{method:'POST',path:'/v1/host/commands',payload:{handlerId:'local.dev.status',arguments:[],options:{payload:JSON.stringify(args.includes('--session')?{sessionId:'dev-exact',all:false}:{all:args.includes('--all')})}}}]);
   assert.equal(existsSync(env.XDG_STATE_HOME),false);return{code,stdout,stderr};
  };
  for(const args of [[],['--all'],['--session','dev-exact']]){const result=await execute(args);assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout).result,inventory);}
  for(const fault of ['denied','malformed','interrupted']as const){mode=fault;const result=await execute(['--all']);failures.push(result);assert.equal(result.code,1);assert.equal(result.stdout,'');assert.equal(JSON.parse(result.stderr).ok,false);if(fault==='denied')assert.equal(JSON.parse(result.stderr).error.code,'native_manager_denied');}
  const retained=structuredClone(failures);mode='accept';const result=await execute(['--all']);assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).result,inventory);
  assert.deepEqual(failures,retained);assert.deepEqual(inventory,frozen);assert.equal(requests.length,7);assert.deepEqual(readFileSync(entrypoint),entryBytes);
 }finally{
  try{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(accept=>child!.once('close',()=>accept()));}}
  finally{try{server.closeAllConnections();if(server.listening)await new Promise<void>((accept,reject)=>server.close(error=>error?reject(error):accept()));}
   finally{assert.equal(existsSync(socket),false);rmSync(root,{recursive:true,force:true});}}
 }
});

