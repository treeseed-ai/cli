import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, chmodSync, rmSync, existsSync, symlinkSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

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
    for(const kind of ['hash','duplicate','schema','symlink','extra','configuration','address','closure']){
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
        if(kind==='closure'){rmSync(join(fixture.tree,'node_modules/@fixture/helper'),{recursive:true});fixture.refresh();}
        fixture.permissions(fixture.tree,true);const result=fixture.run();expect(result.status).toBe(3);expect(result.stdout+result.stderr).not.toContain('canary');expect(existsSync(fixture.marker)).toBe(false);
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
const suite=new CompositionProgramTests();
test('smoke: compiled_cli_uses_cordis_and_selected_deployment_provider without Node Bun or cwd modules',suite.selected.bind(suite));
test('smoke: installed provider byte and dependency failures block before import',suite.rejected.bind(suite));

test('smoke: provider constructors and failed disposal cannot report successful CLI completion',suite.lifecycleFailures.bind(suite));
test('smoke: prepared-provider metadata scope ownership and closure are checked before activation',suite.metadataFailures.bind(suite));
