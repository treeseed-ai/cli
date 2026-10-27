import { expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync, statSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { PreparedReleaseFixture } from '@treeseed-cordis/deployment/testing';
import { CliApplication } from '../../src/main.js';
import { ServiceRuntimeFixture } from '@treeseed-cordis/deployment/testing/runtime';
import { ServiceWorkerBuild, ServicePlanStore } from '@treeseed-cordis/deployment';
import { PluginInstallationFixture } from '@treeseed-cordis/deployment/testing/plugins';
import { CanonicalJson, ServiceSchemas, PlatformSchemas, PluginManagementSchemas, type PluginInstallResult, type ServiceResourceReceipt, type CliEnvelope } from '@treeseed-cordis/sdk';

import {CliProgramFixture,CliNetworkFixture} from '../support/cli-program-test-support.js';
export class CliTests extends CliNetworkFixture {
snapshot():string {
    const rows:string[]=[];for(const args of [['ps','-aq'],['image','ls','--no-trunc','-q'],['volume','ls','-q'],['network','ls','-q']]){const result=spawnSync('docker',['--context','default',...args],{encoding:'utf8'});expect(result.status).toBe(0);rows.push(result.stdout.split('\n').sort().join('\n'));}return JSON.stringify(rows);
  }
}
export class ProviderFixture {
  readonly root=mkdtempSync(join(tmpdir(),'cordis installed provider Ω '));
  tree=join(this.root,'prepared package');
  readonly marker=join(this.root,'live-effect');
  readonly importMarker=join(this.root,'module-imported');
  get file():string{return join(this.tree,'composition.json');}
  readonly declaration={id:'fixture-one',pluginId:'fixture',capability:'deployment',contractVersion:'0.3.0-cordis.1',target:'cli',provide:['deployment'],inject:[]};
  digest='';
  constructor(readonly label='one') {}
  static sha(value:Uint8Array|string):string {return createHash('sha256').update(value).digest('hex');}
  copy(source:string,destination:string):void {
    mkdirSync(destination,{recursive:true});
    for(const entry of readdirSync(source,{withFileTypes:true})) {
      const from=join(source,entry.name),to=join(destination,entry.name);
      if(entry.isDirectory())this.copy(from,to);else if(entry.isFile())copyFileSync(from,to);else throw new Error('Fixture dependency is not a regular package tree');
    }
  }
  async prepare():Promise<this> {
    mkdirSync(this.tree);this.declaration.id='fixture-'+this.label;
    // These are real pinned installed third-party packages, copied as fixture bytes, not mocked modules.
    for(const name of ['cordis','cosmokit','@standard-schema/spec'])this.copy(resolve('node_modules',name),join(this.tree,'node_modules',name));
    const helper=join(this.tree,'node_modules/@fixture/helper');mkdirSync(helper,{recursive:true});
    writeFileSync(join(helper,'package.json'),JSON.stringify({name:'@fixture/helper',version:'1.0.0',type:'module',exports:'./index.js'}));
    const helperSource=join(this.root,'helper.ts');writeFileSync(helperSource,'export class Helper {static label():string{return "ordinary-dependency";}}');
    let build=spawnSync('bun',['build',helperSource,'--target=node','--outfile',join(helper,'index.js')],{encoding:'utf8'});expect(build.status).toBe(0);
    const source=join(this.root,'provider.ts');
    writeFileSync(source,`import {Context} from 'cordis';import {Helper} from '@fixture/helper';import {writeFileSync,unlinkSync} from 'node:fs';
class ImportCanary {static run(){writeFileSync(${JSON.stringify(this.importMarker)},'imported');}}ImportCanary.run();
class Configuration {static validate(value:unknown){return value&&typeof value==='object'&&Object.keys(value).length===0?{value}:{issues:[{message:'Invalid configuration'}]};}}
export class Provider {
static readonly declaration=${JSON.stringify(this.declaration)};
static readonly provide=Provider.declaration.provide;static readonly inject=Provider.declaration.inject;
static readonly Config={'~standard':{version:1,vendor:'fixture',validate:Configuration.validate.bind(Configuration)}};
constructor(readonly ctx:Context){if(!Context.is(ctx)||ctx.registry.get(Provider)!==ctx[Context.root].registry.get(Provider))throw new Error('not native shared graph');writeFileSync(${JSON.stringify(this.marker)},'active');ctx.provide('deployment',this);ctx.effect(this.effect.bind(this));if(${JSON.stringify(this.label)}==='constructor-fail')throw new Error('secret-constructor-canary');}
effect(){return this.close.bind(this);}close(){unlinkSync(${JSON.stringify(this.marker)});if(${JSON.stringify(this.label)}==='cleanup-fail')throw new Error('secret-cleanup-canary');}
async diagnose(){return {ready:true,host:{os:'fixture',architecture:'x64',distribution:'fixture',release:'1'},engine:{context:${JSON.stringify(this.label)},endpoint:null,serverVersion:null,serverArchitecture:null,composeVersion:null,cpus:null,memoryBytes:null},installation:{path:'/fixture',exists:false,freeBytes:null},port:8443,checks:[{id:'native-provider',status:'pass',code:'FIXTURE',message:Helper.label()}]};}
async plan(){throw new Error('fixture is diagnosis-only');}}
`);
    build=spawnSync('bun',['build',source,'--target=node','--external','cordis','--external','@fixture/helper','--outfile',join(this.tree,'index.js')],{encoding:'utf8'});expect(build.status).toBe(0);
    writeFileSync(join(this.tree,'package.json'),JSON.stringify({name:'@fixture/provider',version:'1.0.0',type:'module',exports:'./index.js',dependencies:{cordis:'4.0.0-rc.12','@fixture/helper':'1.0.0'},cordis:this.declaration}));
    this.refresh();return this;
  }
  inventory(directory=this.tree,prefix=''):Array<{path:string;sha256:string}> {
    const files:Array<{path:string;sha256:string}>=[];
    for(const entry of readdirSync(directory,{withFileTypes:true}).sort(ProviderFixture.order)){
      if(directory===this.tree&&entry.name==='composition.json')continue;
      const path=join(directory,entry.name),relative=prefix+entry.name;
      if(entry.isDirectory())files.push(...this.inventory(path,relative+'/'));else files.push({path:relative,sha256:ProviderFixture.sha(readFileSync(path))});
    }
    return files;
  }
  static order(a:{name:string},b:{name:string}):number {return a.name.localeCompare(b.name);}
  permissions(directory:string,locked:boolean):void {chmodSync(directory,0o700);for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())this.permissions(path,locked);else chmodSync(path,locked?0o400:0o600);}chmodSync(directory,locked?0o500:0o700);}
  refresh():void {
    this.permissions(this.tree,false);
    const manifest={formatVersion:1,contractVersion:'0.3.0-cordis.1',target:'cli',scopeId:'local-cli',providerId:this.declaration.id,package:{name:'@fixture/provider',version:'1.0.0'},entry:'index.js',configuration:{},files:this.inventory()};
    writeFileSync(this.file,JSON.stringify(manifest));this.address();this.permissions(this.tree,true);
  }
  address():void {this.digest=ProviderFixture.sha(readFileSync(this.file));const destination=join(this.root,this.digest);if(destination!==this.tree){renameSync(this.tree,destination);this.tree=destination;}}
  run(extra:string[]=[]):SpawnSyncReturns<string> {
    const binary=join(this.root,'trsd link');if(!existsSync(binary))symlinkSync(resolve('dist/trsd-linux-x64'),binary);
    return spawnSync(binary,['doctor','--json','--composition',this.file,'--composition-digest',this.digest,...extra],{encoding:'utf8',cwd:this.root,env:{...process.env,PATH:''},timeout:15000});
  }
  close():void {this.permissions(this.tree,false);rmSync(this.root,{recursive:true,force:true});}
}
export class ExtensiblePlanProgramTests extends CliTests {
 protected listeners():string{const rows:string[]=[];for(const path of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of readFileSync(path,'utf8').trim().split('\n').slice(1)){const fields=line.trim().split(/\s+/);if(fields[3]==='0A')rows.push(fields[1]!);}return rows.sort().join('\n');}
}
export class InstalledProgramTests {
  protected worker: { pid: number; dev: number; ino: number } | null = null;
  protected json(program: CliProgramFixture, args: string[], environment: NodeJS.ProcessEnv = {}): ReturnType<typeof ServiceSchemas.envelope.parse> { const result = program.run(args, environment, program.symlink); if (result.status !== 0) throw new Error('Compiled installed command failed: ' + result.stdout + result.stderr); expect(result.stderr).toBe(''); return ServiceSchemas.envelope.parse(JSON.parse(result.stdout)); }
  protected signal(signal: NodeJS.Signals): void { if (!this.worker) return; try { const current = statSync('/proc/' + this.worker.pid + '/exe'); if (current.dev === this.worker.dev && current.ino === this.worker.ino) process.kill(this.worker.pid, signal); } catch { } }
  protected static delay(done: (value: void) => void): void { setTimeout(done, 100); }
}
export class InstalledPluginCliTests {
  protected worker: { pid: number; dev: number; ino: number } | null = null;
  protected static delay(done: (value: void) => void): void { setTimeout(done, 50); }
  protected static hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
  protected request(program: CliProgramFixture, args: string[], expected?: number): ReturnType<typeof PluginManagementSchemas.envelope.parse> {
    const result=program.run(['plugin',...args,'--json']);
    if(result.status===null)throw new Error('Built CLI terminated without an exit status');
    if(expected!==undefined&&result.status!==expected){const envelope=PluginManagementSchemas.envelope.parse(JSON.parse(result.stdout));const codes:string[]=[];for(const blocker of envelope.blockers)codes.push(blocker.code);throw new Error('CLI_PLUGIN_READBACK:'+args[0]+':'+result.status+':'+envelope.problem?.code+':'+codes.join(','));}
    if(expected===undefined)expect([0,3]).toContain(result.status);else expect(result.status).toBe(expected);
    expect(result.stderr).toBe('');expect(result.stdout).not.toContain('NEVER_INHERIT');return PluginManagementSchemas.envelope.parse(JSON.parse(result.stdout));
  }
  protected async settled(program: CliProgramFixture, installation: string, input: PluginInstallResult): Promise<PluginInstallResult> {
    let result=input;const deadline=Date.now()+150000;
    while(result.state==='pending'&&Date.now()<deadline){await new Promise(InstalledPluginCliTests.delay);result=PluginManagementSchemas.result.parse(this.request(program,['inspect',result.requestId,'--installation',installation],0).result);}
    return result;
  }
  protected receipts(store: ServicePlanStore): Map<string, ServiceResourceReceipt> {
    const result=new Map<string, ServiceResourceReceipt>();const all=store.resources();
    for(const receipt of all)for(const binding of store.current()!.resources)if(receipt.resourceId===binding.resourceId){const prior=result.get(receipt.resourceId);if(!prior||prior.references.length<receipt.references.length)result.set(receipt.resourceId,receipt);}
    return result;
  }
  protected same(store: ServicePlanStore, before: Map<string, ServiceResourceReceipt>, files: Map<string,string>): void {
    const current=this.receipts(store);
    for(const [id,receipt]of before){const next=current.get(id);expect(next).toBeDefined();expect(next!.actualId).toBe(receipt.actualId);expect(next!.creatingGeneration).toBe(receipt.creatingGeneration);expect(next!.definitionDigest).toBe(receipt.definitionDigest);expect(next!.contentDigest).toBe(receipt.contentDigest);expect(next!.path).toBe(receipt.path);}
    for(const [path,digest]of files)expect(InstalledPluginCliTests.hash(readFileSync(join(store.path,path)))).toBe(digest);
  }
  protected async direct(store: ServicePlanStore, id: string): Promise<void> {
    for(const receipt of this.receipts(store).values())if(receipt.kind==='container'&&receipt.serviceId===id&&receipt.actualId){
      const inspected=spawnSync('docker',['container','inspect','--format','{{json .NetworkSettings.Networks}}',receipt.actualId],{encoding:'utf8'});expect(inspected.status).toBe(0);const networks=JSON.parse(inspected.stdout) as Record<string,{IPAddress:string}>;let address:string|undefined;for(const network of Object.values(networks))address=network.IPAddress;expect(address).toBeDefined();
      const response=await fetch('http://'+address+':8080/'),body=await response.json() as {serviceId:string;passwordPresent:boolean;volumeMarker:string};expect(response.ok).toBe(true);expect(body.serviceId).toBe(id);expect(body.passwordPresent).toBe(true);expect(body.volumeMarker).toBe(id);return;
    }
    throw new Error('Installed CLI fixture endpoint missing');
  }
  protected identify(installation: string): void {
    const child=JSON.parse(readFileSync(join(installation,'.cordis/launch/child.json'),'utf8')),file=statSync(join(installation,'.cordis/worker')),running=statSync('/proc/'+child.pid+'/exe');
    expect(file.dev).toBe(running.dev);expect(file.ino).toBe(running.ino);expect(file.uid).toBe(process.getuid!());this.worker={pid:child.pid,dev:running.dev,ino:running.ino};
  }
  protected signal(signal: NodeJS.Signals): void {if(!this.worker)return;try{const current=statSync('/proc/'+this.worker.pid+'/exe');if(current.dev===this.worker.dev&&current.ino===this.worker.ino)process.kill(this.worker.pid,signal);}catch{}}
}
export class LivePluginCliTests {
  protected static pause(done:(value:void)=>void):void{setTimeout(done,50);}
  protected run(program:CliProgramFixture,args:string[],code?:number):ReturnType<typeof PluginManagementSchemas.envelope.parse>{const output=program.run(['plugin',...args,'--json']);expect(output.stderr).toBe('');if(code!==undefined)expect(output.status).toBe(code);else expect([0,3]).toContain(output.status!);expect(output.stdout).not.toContain('NEVER_INHERIT');return PluginManagementSchemas.envelope.parse(JSON.parse(output.stdout));}
  protected async settled(program:CliProgramFixture,installation:string,input:PluginInstallResult):Promise<PluginInstallResult>{let result=input;const until=Date.now()+180000;while(result.state==='pending'&&Date.now()<until){await new Promise(LivePluginCliTests.pause);result=PluginManagementSchemas.result.parse(this.run(program,['inspect',result.requestId,'--installation',installation],0).result);}return result;}
  protected static physical(receipt:ServiceResourceReceipt):string{const {references,...identity}=receipt;return JSON.stringify(identity);}
  protected static digest(digest:string,receipt:ServiceResourceReceipt):boolean{return CanonicalJson.digest(receipt)===digest;}
  protected static next(service:{serviceId:string;observations:string[]}):boolean{return service.serviceId==='instance-2'&&service.observations.includes('fixture.live.next');}
}
