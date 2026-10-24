import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createServer, type Server } from 'node:net';
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
        const version=fixture.run(['--version'],{PATH:''},binary);expect(version.status).toBe(0);expect(version.stdout).toBe('trsd 0.0.0-cordis.1\n');expect(version.stderr).toBe('');
        const help=fixture.run(['--help'],{PATH:''},binary);expect(help.status).toBe(0);expect(help.stdout).toContain('doctor');expect(help.stderr).toBe('');
      }
      expect(readdirSync(fixture.cwd)).toEqual([]);
    }finally{fixture.close();}
  }
  async diagnosis():Promise<void> {
    const fixture=new CliProgramFixture();
    try {
      writeFileSync(join(fixture.cwd,'.env'),'DOCKER_HOST=ssh://secret-canary.invalid\n');
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
      const plan=PlatformSchemas.plan.parse(envelope.result);expect(plan.expectedComposition).toBeNull();expect(plan.blockers).toEqual([]);expect(plan.artifacts.length).toBe(2);expect(plan.configuration).toEqual(fixture.configuration);
      const reference=join(fixture.installation,'.cordis/plans',plan.id+'.json');expect(envelope.references).toEqual([reference]);expect(JSON.parse(readFileSync(reference,'utf8'))).toEqual(plan);expect(statSync(reference).mode&0o777).toBe(0o600);expect(statSync(join(fixture.installation,'.cordis')).mode&0o777).toBe(0o700);
      const repeat=program.run(['platform','plan','--file',configuration,'--json']);expect(repeat.status).toBe(0);expect(repeat.stdout).toBe(result.stdout);
      expect(readdirSync(fixture.installation)).toEqual(['.cordis']);expect(existsSync(join(fixture.installation,'.cordis/credentials'))).toBe(false);expect(existsSync(join(fixture.root,'SCRIPT_CANARY'))).toBe(false);expect(this.snapshot()).toBe(before);
      const doctor=program.run(['doctor','--json','--installation',fixture.installation,'--port',String(plan.configuration.origin.split(':').pop())]);expect(doctor.status).toBe(0);
      writeFileSync(join(fixture.bundle,'archives/plugin.tgz'),'tampered');const blocked=program.run(['platform','plan','--file',configuration,'--json']);expect(blocked.status).toBe(3);const rejected=JSON.parse(blocked.stdout) as CliEnvelope;expect(rejected.result).toBeNull();expect(rejected.references).toEqual([]);expect(readdirSync(join(fixture.installation,'.cordis/plans'))).toEqual([plan.id+'.json']);
    }finally{fixture.close();program.close();}
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
