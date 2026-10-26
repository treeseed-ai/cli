import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync, statSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { PreparedReleaseFixture } from '@treeseed-cordis/deployment/testing';
import { CliApplication } from '../src/main.js';
import { ServiceRuntimeFixture } from '@treeseed-cordis/deployment/testing/runtime';
import { ServiceWorkerBuild, ServicePlanStore } from '@treeseed-cordis/deployment';
import { PluginInstallationFixture } from '@treeseed-cordis/deployment/testing/plugins';
import { ServiceSchemas, PlatformSchemas, PluginManagementSchemas, type PluginInstallResult, type ServiceResourceReceipt, type CliEnvelope } from '@treeseed-cordis/sdk';

class CliProgramFixture {
  readonly root=mkdtempSync(join(tmpdir(),'cordis cli '));
  readonly cwd=join(this.root,'foreign cwd');
  readonly binary=join(this.root,'path with spaces','trsd');
  readonly symlink=join(this.root,'trsd-link');
  constructor() {mkdirSync(this.cwd);mkdirSync(join(this.root,'path with spaces'));copyFileSync(resolve('dist/trsd-linux-x64'),this.binary);symlinkSync(this.binary,this.symlink);}
  run(args:string[],environment:NodeJS.ProcessEnv={},binary=this.binary):SpawnSyncReturns<string> {return spawnSync(binary,args,{cwd:this.cwd,env:{...process.env,...environment},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});}
  close():void {rmSync(this.root,{recursive:true,force:true});}
}
class CliTests {
  server:Server|null=null;
  resolvePort:((port:number)=>void)|null=null;
  listen(resolvePort:(port:number)=>void):void {this.resolvePort=resolvePort;this.server=createServer();this.server.listen(0,'127.0.0.1',this.listening.bind(this));}
  listening():void {const address=this.server!.address();if(address&&typeof address==='object')this.resolvePort!(address.port);}
  async port(occupied=false):Promise<number> {const port=await new Promise<number>(this.listen.bind(this));if(!occupied)this.server!.close();return port;}
  pluginArguments():void {
    const fixture=new CliProgramFixture();
    try {
      for(const args of [
        ['plugin','install','--json'],
        ['plugin','install','@fixture/example','--installation','relative','--json'],
        ['plugin','select','probe.service','example.probe','--installation',fixture.root,'--json'],
        ['plugin','inspect','--installation',fixture.root,'--json'],
        ['plugin','list','--installation',fixture.root,'--target','secret-canary','--json'],
        ['plugin','install','@fixture/example','--installation',fixture.root,'--binding','invalid','--json']
      ]) {const result=fixture.run(args,{PATH:''});expect(result.status).toBe(2);expect(result.stderr).toBe('');const envelope=JSON.parse(result.stdout);expect(envelope.command).toBe('plugin.'+args[1]);expect(envelope.result).toBeNull();expect(envelope.problem.code).toBe('INVALID_ARGUMENTS');expect(result.stdout).not.toContain('secret-canary');}
      const configuration=join(fixture.root,'provider.json'),installation=join(fixture.root,'uncreated');
      for(const bytes of ['{"enabled":true,"enabled":false}','{"__proto__":{"secret":"secret-canary"}}','[1,2]','malformed secret-canary']){writeFileSync(configuration,bytes);const result=fixture.run(['plugin','install','@fixture/example','--installation',installation,'--configuration',configuration,'--json'],{PATH:''});expect(result.status).toBe(2);expect(JSON.parse(result.stdout).problem.code).toBe('INVALID_ARGUMENTS');expect(result.stdout+result.stderr).not.toContain('secret-canary');expect(existsSync(installation)).toBe(false);}
      const digest='0'.repeat(64),restart=fixture.run(['platform','apply','--installation',installation,'--plan','plan-'+digest,'--digest',digest,'--idempotency-key','explicit-restart','--restart','example','--json'],{PATH:''});expect(restart.status).toBe(1);expect(JSON.parse(restart.stdout).problem.code).toBe('RUNTIME_FAILURE');expect(existsSync(installation)).toBe(false);
      const help=fixture.run(['--help'],{PATH:''});expect(help.stdout).toContain('plugin install');expect(help.stdout).toContain('--restart');
      const empty=fixture.run(['plugin','list','--installation',join(fixture.root,'missing'),'--json'],{PATH:''});expect(empty.status).toBe(3);expect(JSON.parse(empty.stdout).result).toBeNull();expect(existsSync(join(fixture.root,'missing'))).toBe(false);
    } finally {fixture.close();}
  }
  installedArguments():void {
    const fixture=new CliProgramFixture();
    try{for(const command of ["apply","status","application"]){const result=fixture.run(["platform",command,"--json"],{PATH:""});expect(result.status).toBe(2);expect(result.stderr).toBe("");expect(JSON.parse(result.stdout).problem.code).toBe("INVALID_ARGUMENTS");}}finally{fixture.close();}
  }
  identity():void {
    const fixture=new CliProgramFixture();
    try {
      for(const binary of [fixture.binary,fixture.symlink]) {
        const version=fixture.run(['--version'],{PATH:''},binary);expect(version.status).toBe(0);expect(version.stdout).toBe('trsd 0.0.0-cordis.7\n');expect(version.stderr).toBe('');
        const help=fixture.run(['--help'],{PATH:''},binary);expect(help.status).toBe(0);expect(help.stdout).toContain('doctor');expect(help.stderr).toBe('');
      }
      expect(readdirSync(fixture.cwd)).toEqual([]);
    }finally{fixture.close();}
  }
  async diagnosis():Promise<void> {
    const fixture=new CliProgramFixture();
    try {
      writeFileSync(join(fixture.cwd,'.env'),'DOCKER_HOST=ssh://secret-canary.invalid\n');
      writeFileSync(join(fixture.cwd,'package.json'),JSON.stringify({type:'commonjs',imports:{'#redirect':'./preload.ts'},scripts:{preinstall:'touch poison-marker'},bun:{preload:['./preload.ts']}}));
      writeFileSync(join(fixture.cwd,'tsconfig.json'),JSON.stringify({compilerOptions:{paths:{cordis:['./preload.ts']}}}));
      writeFileSync(join(fixture.cwd,'bunfig.toml'),'preload = ["./preload.ts"]\n');
      writeFileSync(join(fixture.cwd,'preload.ts'),'class Poison {static run(){Bun.write("poison-marker","ran");}} Poison.run();');
      const before=spawnSync('docker',['ps','-aq'],{encoding:'utf8'}).stdout;
      const result=fixture.run(['doctor','--json','--installation',join(fixture.root,'installation'),'--port',String(await this.port())]);
      expect(result.stderr).toBe('');const envelope=JSON.parse(result.stdout) as CliEnvelope;expect(PlatformSchemas.envelope.safeParse(envelope).success).toBe(true);
      expect(envelope.command).toBe('doctor');expect(result.stdout).not.toContain('secret-canary');expect(existsSync(join(fixture.cwd,'poison-marker'))).toBe(false);
      expect(existsSync(join(fixture.root,'installation'))).toBe(false);expect(spawnSync('docker',['ps','-aq'],{encoding:'utf8'}).stdout).toBe(before);
      if(envelope.result&&'host' in envelope.result&&envelope.result.host.distribution==='ubuntu'&&envelope.result.host.release==='26.04') {expect(result.status).toBe(0);expect(envelope.success).toBe(true);} else {expect(result.status).toBe(3);expect(envelope.success).toBe(false);}
    }finally{fixture.close();}
  }
  async blockers():Promise<void> {
    const fixture=new CliProgramFixture();
    try {
      const missing=fixture.run(['doctor','--json','--installation',join(fixture.root,'new'),'--port',String(await this.port())],{PATH:''});expect(missing.status).toBe(3);expect(missing.stdout).toContain('DOCKER_UNAVAILABLE');
      const remote=fixture.run(['doctor','--json','--installation',join(fixture.root,'new'),'--port',String(await this.port())],{DOCKER_HOST:'ssh://secret-canary.invalid'});expect(remote.status).toBe(3);expect(remote.stdout).toContain('REMOTE_ENGINE');expect(remote.stdout+remote.stderr).not.toContain('secret-canary');
      writeFileSync(join(fixture.cwd,'credentials'),'secret-canary');
      const foreign=fixture.run(['doctor','--json','--installation',fixture.cwd,'--port',String(await this.port())]);expect(foreign.status).toBe(3);expect(foreign.stdout).toContain('FOREIGN_INSTALLATION');expect(foreign.stdout).not.toContain('secret-canary');
      const occupied=await this.port(true);
      try {const result=fixture.run(['doctor','--json','--installation',join(fixture.root,'new'),'--port',String(occupied)]);expect(result.status).toBe(3);expect(result.stdout).toContain('PORT_UNAVAILABLE');}finally{this.server!.close();}
      expect(existsSync(join(fixture.root,'new'))).toBe(false);
    }finally{fixture.close();}
  }
  invalidProgram():void {
    const fixture=new CliProgramFixture();
    try {
      for(const args of [['secret-canary'],['doctor','--secret-canary'],['doctor','--port'],['doctor','--port','0'],['doctor','--port','1.5'],['doctor','--context','a','--context','b']]) {
        const result=fixture.run(args);expect(result.status).toBe(2);expect(result.stderr).toContain('--help');expect(result.stdout+result.stderr).not.toContain('secret-canary');
      }
      const unsupported=fixture.run(['platform','install']);expect(unsupported.status).toBe(3);expect(unsupported.stderr).toContain('UNSUPPORTED_COMMAND');
    }finally{fixture.close();}
  }
  async defaultComposition():Promise<void> {
    const root=mkdtempSync(join(tmpdir(),'cordis-default-'));
    try {const result=await new CliApplication().execute(['doctor','--installation',join(root,'new'),'--port',String(await this.port())]);expect(result.envelope.result).not.toBeNull();expect(result.envelope.command).toBe('doctor');expect(result.envelope.result&&'host' in result.envelope.result).toBe(true);expect(readdirSync(root)).toEqual([]);}
    finally {rmSync(root,{recursive:true,force:true});}
  }
  snapshot():string {
    const rows:string[]=[];for(const args of [['ps','-aq'],['image','ls','--no-trunc','-q'],['volume','ls','-q'],['network','ls','-q']]){const result=spawnSync('docker',['--context','default',...args],{encoding:'utf8'});expect(result.status).toBe(0);rows.push(result.stdout.split('\n').sort().join('\n'));}return JSON.stringify(rows);
  }
  async plan_changes_no_runtime():Promise<void> {
    const program=new CliProgramFixture(),fixture=await new PreparedReleaseFixture().prepare(await this.port());
    try {
      const configuration=join(program.cwd,'desired.json');writeFileSync(configuration,JSON.stringify(fixture.configuration));
      const before=this.snapshot(),result=program.run(['platform','plan','--file',configuration,'--json']);
      const host=readFileSync('/etc/os-release','utf8'),qualified=/VERSION_ID="?26\.04/.test(host)&&process.arch==='x64';
      expect(result.stderr).toBe('');
      if(!qualified&&process.env.CORDIS_REQUIRE_PLAN!=='1'){expect(result.status).toBe(3);expect(result.stdout).toContain('UNSUPPORTED_HOST');expect(existsSync(fixture.installation)).toBe(false);return;}
      expect(result.status).toBe(0);const envelope=JSON.parse(result.stdout) as CliEnvelope;expect(envelope.success).toBe(true);expect(PlatformSchemas.envelope.safeParse(envelope).success).toBe(true);
      expect(envelope.result&&'id' in envelope.result).toBe(true);
      const plan=PlatformSchemas.plan.parse(envelope.result);expect(plan.expectedComposition).toBeNull();expect(plan.blockers).toEqual([]);expect(plan.artifacts.length).toBe(2);expect(plan.configuration).toEqual(fixture.configuration);expect(plan.recipe).toEqual(fixture.recipe);expect(plan.pluginBindings).toEqual([fixture.metadata]);
      const reference=join(fixture.installation,'.cordis/plans',plan.id+'.json');expect(envelope.references).toEqual([reference]);expect(JSON.parse(readFileSync(reference,'utf8'))).toEqual(plan);expect(statSync(reference).mode&0o777).toBe(0o600);expect(statSync(join(fixture.installation,'.cordis')).mode&0o777).toBe(0o700);
      const repeat=program.run(['platform','plan','--file',configuration,'--json']);expect(repeat.status).toBe(0);expect(repeat.stdout).toBe(result.stdout);
      const dockerOnly=join(program.root,'docker-only');mkdirSync(dockerOnly);let docker:string|null=null;for(const directory of (process.env.PATH??'').split(':')){const path=join(directory,'docker');if(existsSync(path)){docker=path;break;}}expect(docker).not.toBeNull();symlinkSync(docker!,join(dockerOnly,'docker'));const standalone=program.run(['platform','plan','--file',configuration,'--json'],{PATH:dockerOnly});expect(standalone.status).toBe(0);expect(standalone.stdout).toBe(result.stdout);
      expect(readdirSync(fixture.installation)).toEqual(['.cordis']);expect(existsSync(join(fixture.installation,'.cordis/credentials'))).toBe(false);expect(existsSync(join(fixture.root,'SCRIPT_CANARY'))).toBe(false);expect(this.snapshot()).toBe(before);
      const human=program.run(['platform','plan','--file',configuration]);expect(human.status).toBe(0);expect(human.stdout).toContain('Future effects only');expect(human.stdout).toContain('Volume mounts');expect(human.stdout).toContain('application | data | /data | Read/write');
      const doctor=program.run(['doctor','--json','--installation',fixture.installation,'--port',String(plan.configuration.origin.split(':').pop())]);expect(doctor.status).toBe(0);
      writeFileSync(join(fixture.bundle,'archives/plugin.tgz'),'tampered');const blocked=program.run(['platform','plan','--file',configuration,'--json']);expect(blocked.status).toBe(3);const rejected=JSON.parse(blocked.stdout) as CliEnvelope;expect(rejected.result).toBeNull();expect(rejected.references).toEqual([]);expect(readdirSync(join(fixture.installation,'.cordis/plans'))).toEqual([plan.id+'.json']);
    }finally{fixture.close();program.close();}
  }
  async installationPaths():Promise<void> {
    const program=new CliProgramFixture(),fixture=await new PreparedReleaseFixture().prepare(await this.port());
    const installation=join(fixture.root,'installation with spaces Ω');
    try {const file=join(program.cwd,'desired path.json');writeFileSync(file,JSON.stringify({...fixture.configuration,installationDirectory:installation}));const result=program.run(['platform','plan','--file',file,'--json']);const qualified=/^VERSION_ID="?26\.04/m.test(readFileSync('/etc/os-release','utf8'))&&process.arch==='x64';if(!qualified&&process.env.CORDIS_REQUIRE_PLAN!=='1'){expect(result.status).toBe(3);expect(existsSync(installation)).toBe(false);return;}expect(result.status).toBe(0);const plan=PlatformSchemas.plan.parse(JSON.parse(result.stdout).result);expect(plan.configuration.installationDirectory).toBe(installation);expect(readdirSync(installation)).toEqual(['.cordis']);expect(existsSync(join(installation,'.cordis/plans',plan.id+'.json'))).toBe(true);}finally{fixture.close();program.close();}
  }
  async invalidPlans():Promise<void> {
    const fixture=new CliProgramFixture();
    try {
      const file=join(fixture.cwd,'invalid.json');
      for(const text of ['{"password":"plaintext-secret-canary"}', '{"installationId":"a","installationId":"b"}', '{"__proto__":{"password":"plaintext-secret-canary"}}', 'not json plaintext-secret-canary']){
        writeFileSync(file,text);const result=fixture.run(['platform','plan','--file',file,'--json']);expect(result.status).toBe(2);const envelope=JSON.parse(result.stdout) as CliEnvelope;expect(envelope.result).toBeNull();expect(envelope.references).toEqual([]);expect(result.stdout+result.stderr).not.toContain('plaintext-secret-canary');
      }
      for(const args of [['platform','plan','--json'],['platform','plan','--file',file,'--file',file,'--json'],['platform','plan','--file',file,'--apply','--json']]){const result=fixture.run(args);expect(result.status).toBe(2);expect(JSON.parse(result.stdout).command).toBe('platform.plan');}
    }finally{fixture.close();}
  }
  async parser():Promise<void> {
    const app=new CliApplication();
    expect((await app.execute(['--help'])).code).toBe(0);expect((await app.execute(['--version'])).code).toBe(0);
    expect((await app.execute(['doctor','--json','--port','bad'])).code).toBe(2);
    expect((await app.execute(['apply'])).code).toBe(3);
  }
}
const suite=new CliTests();
test('smoke: standalone identity from spaces, symlink, foreign cwd and closed stdin',suite.identity.bind(suite));
test('smoke: doctor JSON and no filesystem/container mutation or cwd autoload',suite.diagnosis.bind(suite));
test('smoke: wrong engine, missing Docker, foreign installation and occupied port',suite.blockers.bind(suite));
test('smoke: invalid arguments and unsupported commands are actionable',suite.invalidProgram.bind(suite));
test('integration: default CLI construction uses real packaged diagnostics',suite.defaultComposition.bind(suite));
test('unit: parser help, version and error classifications',suite.parser.bind(suite));

test('smoke: plan_changes_no_runtime using real prepared artifacts',suite.plan_changes_no_runtime.bind(suite));

test('smoke: invalid and duplicate planning inputs never echo secrets or claim saved state',suite.invalidPlans.bind(suite));

test('smoke: plan new installation directory with spaces and Unicode',suite.installationPaths.bind(suite));

class ProviderFixture {
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
class CompositionProgramTests {
  async selected():Promise<void> {
    for(const label of ['one','two']){
      const fixture=await new ProviderFixture(label).prepare();
      try {const result=fixture.run();expect(result.status).toBe(0);expect(result.stderr).toBe('');const envelope=JSON.parse(String(result.stdout));expect(envelope.result.engine.context).toBe(label);expect(envelope.result.checks).toContainEqual({id:'native-provider',status:'pass',code:'FIXTURE',message:'ordinary-dependency'});expect(existsSync(fixture.marker)).toBe(false);const repeat=fixture.run();expect(repeat.status).toBe(0);expect(repeat.stdout).toBe(result.stdout);expect(existsSync(fixture.marker)).toBe(false);}finally{fixture.close();}
    }
  }
  async lifecycleFailures():Promise<void> {
    for(const label of ['constructor-fail','cleanup-fail']){const fixture=await new ProviderFixture(label).prepare();try{const result=fixture.run();expect(result.status).toBe(1);expect(JSON.parse(result.stdout).success).toBe(false);expect(JSON.parse(result.stdout).result).toBeNull();expect(result.stdout+result.stderr).not.toContain('canary');expect(existsSync(fixture.marker)).toBe(false);}finally{fixture.close();}}
  }
  async metadataFailures():Promise<void> {
    for(const kind of ['hash','duplicate','schema','symlink','extra','configuration','address','closure','scope','file-mode','directory-mode','capability']){
      const fixture=await new ProviderFixture().prepare();
      try {
        fixture.permissions(fixture.tree,false);
        if(kind==='hash')fixture.digest='0'.repeat(64);
        if(kind==='duplicate'){writeFileSync(fixture.file,'{"formatVersion":1,"formatVersion":1}');fixture.address();}
        if(kind==='schema'){writeFileSync(fixture.file,'{"principalId":"forged-secret-canary"}');fixture.address();}
        if(kind==='symlink')symlinkSync(join(fixture.tree,'index.js'),join(fixture.tree,'unapproved-link'));
        if(kind==='extra')writeFileSync(join(fixture.tree,'unapproved.js'),'secret-canary');
        if(kind==='configuration'){const manifest=JSON.parse(readFileSync(fixture.file,'utf8'));manifest.configuration={extra:'secret-canary'};writeFileSync(fixture.file,JSON.stringify(manifest));fixture.address();}
        if(kind==='address'){const destination=join(fixture.root,'mutable-package');renameSync(fixture.tree,destination);fixture.tree=destination;}
        if(kind==='closure'){const packageFile=join(fixture.tree,'package.json'),metadata=JSON.parse(readFileSync(packageFile,'utf8'));metadata.dependencies['never-imported']='1.0.0';writeFileSync(packageFile,JSON.stringify(metadata));fixture.refresh();}
        if(kind==='capability'){const packageFile=join(fixture.tree,'package.json'),metadata=JSON.parse(readFileSync(packageFile,'utf8'));metadata.cordis.capability='other-capability';metadata.cordis.provide=['other-capability'];writeFileSync(packageFile,JSON.stringify(metadata));fixture.refresh();}
        if(kind==='scope'){const manifest=JSON.parse(readFileSync(fixture.file,'utf8'));manifest.scopeId='foreign-scope';writeFileSync(fixture.file,JSON.stringify(manifest));fixture.address();}
        fixture.permissions(fixture.tree,true);if(kind==='file-mode')chmodSync(join(fixture.tree,'index.js'),0o600);if(kind==='directory-mode')chmodSync(fixture.tree,0o700);const result=fixture.run();expect(result.status).toBe(3);expect(result.stdout+result.stderr).not.toContain('canary');expect(existsSync(fixture.marker)).toBe(false);if(kind==='capability')expect(existsSync(fixture.importMarker)).toBe(false);
      }finally{fixture.close();}
    }
  }
  async rejected():Promise<void> {
    const fixture=await new ProviderFixture().prepare();
    try {
      chmodSync(join(fixture.tree,'index.js'),0o600);writeFileSync(join(fixture.tree,'index.js'),'throw new Error("secret-canary");');chmodSync(join(fixture.tree,'index.js'),0o400);
      const result=fixture.run();expect(result.status).toBe(3);expect(result.stdout+result.stderr).not.toContain('secret-canary');expect(existsSync(fixture.marker)).toBe(false);
    }finally{fixture.close();}
    const missing=await new ProviderFixture().prepare();
    try {missing.permissions(missing.tree,false);rmSync(join(missing.tree,'node_modules/@fixture/helper'),{recursive:true});const result=missing.run();expect(result.status).toBe(3);expect(existsSync(missing.marker)).toBe(false);}finally{missing.close();}
  }
}
const compositionSuite=new CompositionProgramTests();
test('smoke: compiled_cli_uses_cordis_and_selected_deployment_provider without Node Bun or cwd modules',compositionSuite.selected.bind(compositionSuite));
test('smoke: installed provider byte and dependency failures block before import',compositionSuite.rejected.bind(compositionSuite));

test('smoke: provider constructors and failed disposal cannot report successful CLI completion',compositionSuite.lifecycleFailures.bind(compositionSuite));
test('smoke: prepared-provider metadata scope ownership and closure are checked before activation',compositionSuite.metadataFailures.bind(compositionSuite));

test('smoke: installed commands validate arguments before contacting worker',suite.installedArguments.bind(suite));

class UiOutputProgramTests {
 human():void{const fixture=new CliProgramFixture();try{const result=fixture.run(['doctor','--installation',join(fixture.root,'new')],{PATH:''});expect(result.status).toBe(3);expect(result.stdout).toContain('Diagnostic checks');expect(result.stdout).toContain('Check | Result | Code | Detail');expect(result.stderr).toContain('PREREQUISITES_UNMET');expect(result.stdout+result.stderr).not.toContain('\u001b');}finally{fixture.close();}}
}
const uiOutput=new UiOutputProgramTests();test('smoke: built CLI renders structured diagnostic models through reusable terminal providers',uiOutput.human.bind(uiOutput));

class ExtensiblePlanProgramTests extends CliTests {
 private listeners():string{const rows:string[]=[];for(const path of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of readFileSync(path,'utf8').trim().split('\n').slice(1)){const fields=line.trim().split(/\s+/);if(fields[3]==='0A')rows.push(fields[1]!);}return rows.sort().join('\n');}
 async plan():Promise<void>{const {ServiceReleaseFixture}=await import('@treeseed-cordis/deployment/testing'),{ServiceSchemas}=await import('@treeseed-cordis/sdk'),fixture=await new ServiceReleaseFixture().services(),program=new CliProgramFixture();try{const port=await this.port();fixture.configuration.origin='https://localhost:'+port;fixture.release.composition.services[0]!.definition.ports[0]!.publication!.port=port;fixture.recipe.services['instance-0']!.ports![0]!.published=port;fixture.refreshService();const path=join(program.cwd,'service-config.json');writeFileSync(path,JSON.stringify(fixture.configuration));const before=this.snapshot(),listeners=this.listeners(),result=program.run(['platform','plan','--file',path,'--json']);expect(result.status).toBe(0);expect(result.stderr).toBe('');const plan=ServiceSchemas.plan.parse(JSON.parse(result.stdout).result);expect(plan.formatVersion).toBe(3);expect(plan.composition.services).toHaveLength(5);expect(plan.changes).toHaveLength(5);expect(plan.blockers).toEqual([]);const restart=program.run(['platform','apply','--installation',fixture.installation,'--plan',plan.id,'--digest',plan.digest,'--idempotency-key','not-an-additive-restart','--restart','instance-0','--json']);expect(restart.status).toBe(3);expect(JSON.parse(restart.stdout).blockers[0].code).toBe('RESTART_SCOPE_NOT_QUALIFIED');expect(existsSync(join(fixture.installation,'.cordis/launch'))).toBe(false);const saved=join(fixture.installation,'.cordis/plans',plan.id+'.json');expect(ServiceSchemas.plan.parse(JSON.parse(readFileSync(saved,'utf8')))).toEqual(plan);expect(statSync(saved).mode&0o777).toBe(0o600);const again=program.run(['platform','plan','--file',path,'--json']);expect(again.status).toBe(0);expect(again.stdout).toBe(result.stdout);const human=program.run(['platform','plan','--file',path]);expect(human.status).toBe(0);expect(human.stdout).toContain('Services\nService | Image');expect(human.stdout).toContain('instance-4');expect(human.stdout).toContain('Future effects only');const tools=join(program.root,'docker-only');mkdirSync(tools);let docker:string|null=null;for(const directory of(process.env.PATH??'').split(':'))if(existsSync(join(directory,'docker'))){docker=join(directory,'docker');break;}expect(docker).not.toBeNull();symlinkSync(docker!,join(tools,'docker'));const standalone=program.run(['platform','plan','--file',path,'--json'],{PATH:tools});expect(standalone.status).toBe(0);expect(standalone.stdout).toBe(result.stdout);expect(this.snapshot()).toBe(before);expect(this.listeners()).toBe(listeners);expect(existsSync(join(fixture.installation,'.cordis/credentials'))).toBe(false);expect(existsSync(join(fixture.root,'SCRIPT_CANARY'))).toBe(false);writeFileSync(join(fixture.bundle,'archives/plugin.tgz'),'tampered');const blocked=program.run(['platform','plan','--file',path,'--json']);expect(blocked.status).toBe(3);const envelope=JSON.parse(blocked.stdout);expect(envelope.result).toBeNull();expect(envelope.references).toEqual([]);expect(readdirSync(join(fixture.installation,'.cordis/plans'))).toEqual([plan.id+'.json']);}finally{fixture.close();program.close();}}
}
const extensiblePlan=new ExtensiblePlanProgramTests();test('smoke: standalone CLI plans genuine five-instance format3 bundle deterministically without runtime effects',extensiblePlan.plan.bind(extensiblePlan),60000);


class InstalledProgramTests {
  private worker: { pid: number; dev: number; ino: number } | null = null;
  async installed(): Promise<void> {
    const fixture = new ServiceRuntimeFixture(), program = new CliProgramFixture();
    try {
      await fixture.running(); const output = join(fixture.root, 'worker-build'); mkdirSync(output, { mode: 0o700 });
      const descriptor = ServiceWorkerBuild.produce(output); copyFileSync(join(output, descriptor.path), join(fixture.bundle, 'worker'));
      fixture.release.composition.worker = { ...descriptor, path: 'worker' }; fixture.refreshService();
      const input = join(fixture.root, 'configuration.json'); writeFileSync(input, JSON.stringify(fixture.configuration));
      const planResult = this.json(program, ['platform', 'plan', '--file', input, '--json']), plan = ServiceSchemas.plan.parse(planResult.result);
      const docker = spawnSync('which', ['docker'], { encoding: 'utf8' }); if (docker.status !== 0 || !docker.stdout.trim().startsWith('/')) throw new Error('Docker prerequisite missing');
      const path = join(fixture.root, 'docker-only'); mkdirSync(path, { mode: 0o700 }); symlinkSync(docker.stdout.trim(), join(path, 'docker'));
      const environment = { PATH: path }, apply = ['platform', 'apply', '--installation', fixture.installation, '--plan', plan.id, '--digest', plan.digest, '--idempotency-key', 'compiled-format3-program', '--json'];
      const first = PlatformSchemas.apply.parse(this.json(program, apply, environment).result), owner = JSON.parse(readFileSync(join(fixture.installation, '.cordis/writer.lock/owner.json'), 'utf8')) as { pid: number }, executable = statSync(join(fixture.installation, '.cordis/worker')), running = statSync('/proc/' + owner.pid + '/exe');
      if (running.dev !== executable.dev || running.ino !== executable.ino) throw new Error('Wrong worker process'); this.worker = { pid: owner.pid, dev: running.dev, ino: running.ino };
      expect(PlatformSchemas.apply.parse(this.json(program, apply, environment).result).id).toBe(first.id);
      const applicationArgs = ['platform', 'application', '--installation', fixture.installation, '--id', first.id, '--json'], deadline = Date.now() + 120000;
      let application = ServiceSchemas.applicationRecord.parse(this.json(program, applicationArgs, environment).result);
      while (!['completed', 'failed', 'cancelled'].includes(application.phase) && Date.now() < deadline) { await new Promise(InstalledProgramTests.delay); application = ServiceSchemas.applicationRecord.parse(this.json(program, applicationArgs, environment).result); }
      expect(application.phase).toBe('completed'); expect(application.result).toBe('ready');
      const statusArgs = ['platform', 'status', '--installation', fixture.installation, '--json'], status = ServiceSchemas.status.parse(this.json(program, statusArgs, environment).result);
      expect(status.ready).toBe(true); expect(status.services.length).toBe(5); expect(status.activeComposition).toBe(plan.compositionGeneration);
      const human = program.run(['platform', 'status', '--installation', fixture.installation], environment, program.symlink); expect(human.status).toBe(0); expect(human.stderr).toBe(''); expect(human.stdout).toContain('Installed services'); for (const service of status.services) expect(human.stdout).toContain(service.serviceId);
      rmSync(fixture.bundle, { recursive: true }); expect(PlatformSchemas.apply.parse(this.json(program, apply, environment).result).id).toBe(first.id); expect(ServiceSchemas.status.parse(this.json(program, statusArgs, environment).result).ready).toBe(true);
      this.signal('SIGTERM'); const closeDeadline = Date.now() + 15000; while (existsSync(join(fixture.installation, '.cordis/writer.lock')) && Date.now() < closeDeadline) await new Promise(InstalledProgramTests.delay);
      expect(existsSync(join(fixture.installation, '.cordis/writer.lock'))).toBe(false); const refused = program.run(apply, environment, program.symlink); expect(refused.status).toBe(3); expect(ServiceSchemas.envelope.parse(JSON.parse(refused.stdout)).success).toBe(false); expect(existsSync(join(fixture.installation, '.cordis/writer.lock'))).toBe(false);
    } finally {
      if (!this.worker) { try { const owner = JSON.parse(readFileSync(join(fixture.installation, '.cordis/launch/child.json'), 'utf8')) as { pid: number }, file = statSync(join(fixture.installation, '.cordis/worker')), observed = statSync('/proc/' + owner.pid + '/exe'); if (observed.dev === file.dev && observed.ino === file.ino) this.worker = { pid: owner.pid, dev: observed.dev, ino: observed.ino }; } catch { } }
      this.signal('SIGKILL'); fixture.close(); program.close();
    }
  }
  private json(program: CliProgramFixture, args: string[], environment: NodeJS.ProcessEnv = {}): ReturnType<typeof ServiceSchemas.envelope.parse> { const result = program.run(args, environment, program.symlink); if (result.status !== 0) throw new Error('Compiled installed command failed: ' + result.stdout + result.stderr); expect(result.stderr).toBe(''); return ServiceSchemas.envelope.parse(JSON.parse(result.stdout)); }
  private signal(signal: NodeJS.Signals): void { if (!this.worker) return; try { const current = statSync('/proc/' + this.worker.pid + '/exe'); if (current.dev === this.worker.dev && current.ino === this.worker.ino) process.kill(this.worker.pid, signal); } catch { } }
  private static delay(done: (value: void) => void): void { setTimeout(done, 100); }
}
const installedPrograms = new InstalledProgramTests();
test('smoke: standalone CLI applies and observes five format3 services through its default durable host', installedPrograms.installed.bind(installedPrograms), 240000);

test('smoke: built plugin commands validate arguments with safe SDK JSON envelopes and do not create missing installations', suite.pluginArguments.bind(suite),30000);

class InstalledPluginCliTests {
  private worker: { pid: number; dev: number; ino: number } | null = null;
  private static delay(done: (value: void) => void): void { setTimeout(done, 50); }
  private static hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
  private request(program: CliProgramFixture, args: string[], expected?: number): ReturnType<typeof PluginManagementSchemas.envelope.parse> {
    const result=program.run(['plugin',...args,'--json']);
    if(expected===undefined)expect([0,3]).toContain(result.status);else expect(result.status).toBe(expected);
    expect(result.stderr).toBe('');expect(result.stdout).not.toContain('NEVER_INHERIT');return PluginManagementSchemas.envelope.parse(JSON.parse(result.stdout));
  }
  private async settled(program: CliProgramFixture, installation: string, input: PluginInstallResult): Promise<PluginInstallResult> {
    let result=input;const deadline=Date.now()+150000;
    while(result.state==='pending'&&Date.now()<deadline){await new Promise(InstalledPluginCliTests.delay);result=PluginManagementSchemas.result.parse(this.request(program,['inspect',result.requestId,'--installation',installation],0).result);}
    return result;
  }
  private receipts(store: ServicePlanStore): Map<string, ServiceResourceReceipt> {
    const result=new Map<string, ServiceResourceReceipt>();const all=store.resources();
    for(const receipt of all)for(const binding of store.current()!.resources)if(receipt.resourceId===binding.resourceId){const prior=result.get(receipt.resourceId);if(!prior||prior.references.length<receipt.references.length)result.set(receipt.resourceId,receipt);}
    return result;
  }
  private same(store: ServicePlanStore, before: Map<string, ServiceResourceReceipt>, files: Map<string,string>): void {
    const current=this.receipts(store);
    for(const [id,receipt]of before){const next=current.get(id);expect(next).toBeDefined();expect(next!.actualId).toBe(receipt.actualId);expect(next!.creatingGeneration).toBe(receipt.creatingGeneration);expect(next!.definitionDigest).toBe(receipt.definitionDigest);expect(next!.contentDigest).toBe(receipt.contentDigest);expect(next!.path).toBe(receipt.path);}
    for(const [path,digest]of files)expect(InstalledPluginCliTests.hash(readFileSync(join(store.path,path)))).toBe(digest);
  }
  private async direct(store: ServicePlanStore, id: string): Promise<void> {
    for(const receipt of this.receipts(store).values())if(receipt.kind==='container'&&receipt.serviceId===id&&receipt.actualId){
      const inspected=spawnSync('docker',['container','inspect','--format','{{json .NetworkSettings.Networks}}',receipt.actualId],{encoding:'utf8'});expect(inspected.status).toBe(0);const networks=JSON.parse(inspected.stdout) as Record<string,{IPAddress:string}>;let address:string|undefined;for(const network of Object.values(networks))address=network.IPAddress;expect(address).toBeDefined();
      const response=await fetch('http://'+address+':8080/'),body=await response.json() as {serviceId:string;passwordPresent:boolean;volumeMarker:string};expect(response.ok).toBe(true);expect(body.serviceId).toBe(id);expect(body.passwordPresent).toBe(true);expect(body.volumeMarker).toBe(id);return;
    }
    throw new Error('Installed CLI fixture endpoint missing');
  }
  private identify(installation: string): void {
    const child=JSON.parse(readFileSync(join(installation,'.cordis/launch/child.json'),'utf8')),file=statSync(join(installation,'.cordis/worker')),running=statSync('/proc/'+child.pid+'/exe');
    expect(file.dev).toBe(running.dev);expect(file.ino).toBe(running.ino);expect(file.uid).toBe(process.getuid!());this.worker={pid:child.pid,dev:running.dev,ino:running.ino};
  }
  private signal(signal: NodeJS.Signals): void {if(!this.worker)return;try{const current=statSync('/proc/'+this.worker.pid+'/exe');if(current.dev===this.worker.dev&&current.ino===this.worker.ino)process.kill(this.worker.pid,signal);}catch{}}
  async program(): Promise<void> {
    const fixture=new PluginInstallationFixture(),program=new CliProgramFixture();
    try {
      await fixture.prepare();await fixture.startRegistry();
      const file=join(program.cwd,'plugins.json');writeFileSync(file,JSON.stringify(fixture.configuration));const planned=program.run(['platform','plan','--file',file,'--json']);expect(planned.status).toBe(0);expect(planned.stderr).toBe('');expect(ServiceSchemas.plan.parse(JSON.parse(planned.stdout).result).composition.services).toHaveLength(4);
      const tools=join(program.root,'managed-only');mkdirSync(tools);let docker:string|undefined;for(const directory of(process.env.PATH??'').split(':'))if(existsSync(join(directory,'docker'))){docker=join(directory,'docker');break;}expect(docker).toBeDefined();symlinkSync(docker!,join(tools,'docker'));
      const originalPath=process.env.PATH;process.env.PATH=tools;
      try {
        const args=['install',fixture.source(),'--installation',fixture.installation,'--target','deployment','--service','cli-addon-one','--idempotency-key','cli-first'],firstEnvelope=this.request(program,args),first=await this.settled(program,fixture.installation,PluginManagementSchemas.result.parse(firstEnvelope.result));
        this.identify(fixture.installation);expect(first.state).toBe('active');expect(first.acknowledgements.length).toBeGreaterThan(0);expect(first.planId).not.toBeNull();expect(first.applicationId).not.toBeNull();
        const store=new ServicePlanStore(fixture.installation),before=this.receipts(store),files=new Map<string,string>();for(const receipt of before.values())if(receipt.path&&existsSync(join(store.path,receipt.path)))files.set(receipt.path,InstalledPluginCliTests.hash(readFileSync(join(store.path,receipt.path))));
        await this.direct(store,'cli-addon-one');
        const human=program.run(['plugin','inspect','cli-first','--installation',fixture.installation]);expect(human.status).toBe(0);expect(human.stderr).toBe('');expect(human.stdout).toContain('active');expect(human.stdout).toContain('Accepted references');expect(human.stdout).toContain('cli-first');
        const already=await this.settled(program,fixture.installation,PluginManagementSchemas.result.parse(this.request(program,[...args.slice(0,-1),'cli-already']).result));expect(already.state).toBe('already-active');expect(already.applicationId).toBe(first.applicationId);
        const applications=store.records().length,unsafeArgs=['install',fixture.source('2.0.0'),'--installation',fixture.installation,'--target','deployment','--service','cli-addon-one','--idempotency-key','cli-unsafe'],unsafe=await this.settled(program,fixture.installation,PluginManagementSchemas.result.parse(this.request(program,unsafeArgs).result));
        expect(unsafe.state).toBe('prepared');expect(unsafe.nextActions).toContain('review-migration');expect(unsafe.applicationId).toBeNull();expect(store.records().length).toBe(applications);expect(PluginManagementSchemas.result.parse(this.request(program,unsafeArgs,3).result)).toEqual(unsafe);this.same(store,before,files);
        const secondArgs=['install',fixture.source(),'--installation',fixture.installation,'--target','deployment','--service','cli-addon-two','--idempotency-key','cli-second'],second=await this.settled(program,fixture.installation,PluginManagementSchemas.result.parse(this.request(program,secondArgs).result));expect(second.state).toBe('active');this.same(store,before,files);await this.direct(store,'cli-addon-two');
        expect(this.receipts(store).size).toBeGreaterThan(before.size);const historical=PluginManagementSchemas.result.parse(this.request(program,['inspect','cli-first','--installation',fixture.installation],0).result);expect(historical.activeGeneration).toBeNull();expect(historical.acknowledgements).toEqual([]);
        await fixture.stopRegistry();expect(PluginManagementSchemas.result.parse(this.request(program,secondArgs,0).result)).toEqual(second);
        const listed=this.request(program,['list','--installation',fixture.installation],0);expect(Array.isArray(listed.result)).toBe(true);expect((listed.result as PluginInstallResult[]).length).toBe(4);
        expect(existsSync(join(fixture.root,'MUST_NOT_RUN'))).toBe(false);this.signal('SIGTERM');const deadline=Date.now()+15000;while(existsSync(join(fixture.installation,'.cordis/writer.lock'))&&Date.now()<deadline)await new Promise(InstalledPluginCliTests.delay);expect(existsSync(join(fixture.installation,'.cordis/writer.lock'))).toBe(false);this.worker=null;
        const cold=PluginManagementSchemas.result.parse(this.request(program,['inspect','cli-second','--installation',fixture.installation],0).result);expect(cold.state).toBe('recovery-required');expect(cold.activeGeneration).toBeNull();expect(cold.acknowledgements).toEqual([]);
      } finally {process.env.PATH=originalPath;}
    } finally {if(!this.worker){try{this.identify(fixture.installation);}catch{}}this.signal('SIGTERM');if(this.worker){const deadline=Date.now()+15000;while(existsSync(join(fixture.installation,'.cordis/writer.lock'))&&Date.now()<deadline)await new Promise(InstalledPluginCliTests.delay);this.signal('SIGKILL');}await fixture.close();program.close();}
  }
}
const installedPlugins=new InstalledPluginCliTests();
test('smoke: built CLI installs two typed plugin instances with retained credentials and safe UI readback using exact public fixtures',installedPlugins.program.bind(installedPlugins),420000);
