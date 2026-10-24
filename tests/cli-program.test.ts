import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync, statSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { PreparedReleaseFixture } from '@treeseed-cordis/deployment/testing';
import { CliApplication } from '../src/main.js';
import { PlatformSchemas, type CliEnvelope } from '@treeseed-cordis/sdk';

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
  identity():void {
    const fixture=new CliProgramFixture();
    try {
      for(const binary of [fixture.binary,fixture.symlink]) {
        const version=fixture.run(['--version'],{PATH:''},binary);expect(version.status).toBe(0);expect(version.stdout).toBe('trsd 0.0.0-cordis.3\n');expect(version.stderr).toBe('');
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
      const unsupported=fixture.run(['platform','apply']);expect(unsupported.status).toBe(3);expect(unsupported.stderr).toContain('UNSUPPORTED_COMMAND');
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
      const human=program.run(['platform','plan','--file',configuration]);expect(human.status).toBe(0);expect(human.stdout).toContain('Future effects only');expect(human.stdout).toContain('Volume data -> /data');
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
    for(const kind of ['hash','duplicate','schema','symlink','extra','configuration','address','closure','scope','file-mode','directory-mode']){
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
        if(kind==='scope'){const manifest=JSON.parse(readFileSync(fixture.file,'utf8'));manifest.scopeId='foreign-scope';writeFileSync(fixture.file,JSON.stringify(manifest));fixture.address();}
        fixture.permissions(fixture.tree,true);if(kind==='file-mode')chmodSync(join(fixture.tree,'index.js'),0o600);if(kind==='directory-mode')chmodSync(fixture.tree,0o700);const result=fixture.run();expect(result.status).toBe(3);expect(result.stdout+result.stderr).not.toContain('canary');expect(existsSync(fixture.marker)).toBe(false);
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
