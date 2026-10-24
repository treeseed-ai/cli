import { ComposeDeploymentHost, type DeploymentHost } from '@treeseed-cordis/deployment';
import { PlatformSchemas, type CliEnvelope, type DiagnosticConfiguration, type DeploymentConfiguration, PlanningBlockedError } from '@treeseed-cordis/sdk';

import { openSync, fstatSync, readFileSync, closeSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse, visit, type ParseError } from 'jsonc-parser';

export interface CliExecution {code:0|1|2|3;json:boolean;envelope:CliEnvelope;}
class ArgumentProblem extends Error {}
export class CliArguments {
  static readonly help='Usage: trsd --help | --version | doctor [--json] [--context NAME] [--installation ABSOLUTE_PATH] [--port INTEGER] | platform plan --file CONFIG [--json]';
  static readonly unsupported=['platform','plan','apply','status','install','uninstall','update','open','recover','events','cancel','application','development'];
  static plan(args:string[]):DeploymentConfiguration {
    const seen=new Set<string>();let file:string|null=null;
    for(let index=2;index<args.length;index++){const flag=args[index]!;if(seen.has(flag))throw new ArgumentProblem();seen.add(flag);if(flag==='--json')continue;if(flag!=='--file')throw new ArgumentProblem();const value=args[++index];if(!value||value.startsWith('-'))throw new ArgumentProblem();file=resolve(value);}
    if(!file)throw new ArgumentProblem();return new ConfigurationFile().read(file);
  }
  static doctor(args:string[]):DiagnosticConfiguration {
    const configuration:DiagnosticConfiguration={},seen=new Set<string>();
    for(let index=1;index<args.length;index++) {
      const flag=args[index]!;
      if(seen.has(flag))throw new ArgumentProblem();seen.add(flag);
      if(flag==='--json')continue;
      if(!['--context','--installation','--port'].includes(flag))throw new ArgumentProblem();
      const value=args[++index];if(!value||value.startsWith('-'))throw new ArgumentProblem();
      if(flag==='--context') {if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value))throw new ArgumentProblem();configuration.context=value;}
      if(flag==='--installation')configuration.installationDirectory=value;
      if(flag==='--port') {if(!/^[0-9]+$/.test(value))throw new ArgumentProblem();configuration.port=Number(value);}
    }
    const parsed=PlatformSchemas.configuration.safeParse(configuration);if(!parsed.success)throw new ArgumentProblem();return parsed.data;
  }
}
class ConfigurationFile {
  readonly keys:Set<string>[]=[];
  duplicate=false;
  begin():void {this.keys.push(new Set());}
  property(value:string):void {const current=this.keys[this.keys.length-1]!;if(current.has(value)||value==='__proto__')this.duplicate=true;current.add(value);}
  end():void {this.keys.pop();}
  read(path:string):DeploymentConfiguration {
    let fd:number|undefined;
    try {fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw new ArgumentProblem();const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(fd)),errors:ParseError[]=[];visit(text,{onObjectBegin:this.begin.bind(this),onObjectProperty:this.property.bind(this),onObjectEnd:this.end.bind(this)},{disallowComments:true,allowTrailingComma:false});const value:unknown=parse(text,errors,{disallowComments:true,allowTrailingComma:false});if(errors.length||this.duplicate)throw new ArgumentProblem();const parsed=PlatformSchemas.desired.safeParse(value);if(!parsed.success)throw new ArgumentProblem();return parsed.data;}catch{throw new ArgumentProblem();}finally{if(fd!==undefined)closeSync(fd);}
  }
}
export class CliApplication {
  constructor(private readonly host:DeploymentHost=new ComposeDeploymentHost()) {}
  async execute(args:string[]):Promise<CliExecution> {
    const command=args[0]??'--help',planning=command==='platform'&&args[1]==='plan',json=(command==='doctor'||planning)&&args.includes('--json');
    try {
      if((command==='--help'||command==='help')&&args.length<=1)return this.success('help',{help:CliArguments.help});
      if(command==='--version'&&args.length===1)return this.success('version',{version:'0.0.0-cordis.2'});
      if(planning){const plan=await this.host.plan(CliArguments.plan(args));return {code:0,json,envelope:PlatformSchemas.envelope.parse({command:'platform.plan',success:true,result:plan,problem:null,blockers:[],references:[join(plan.configuration.installationDirectory,'.cordis/plans',plan.id+'.json')]})};}
      if(CliArguments.unsupported.includes(command))return this.failure('unsupported',3,false,'UNSUPPORTED_COMMAND','This executable supports help, version, doctor and platform plan. Run trsd --help.');
      if(command!=='doctor')throw new ArgumentProblem();
      const configuration=CliArguments.doctor(args),report=await this.host.diagnose(configuration);
      const blockers=[];for(const check of report.checks)if(check.status==='blocked')blockers.push({code:check.code,message:check.message});
      const envelope=PlatformSchemas.envelope.parse({command:'doctor',success:report.ready,result:report,problem:report.ready?null:{code:'PREREQUISITES_UNMET',title:'Host prerequisites are unmet',detail:'Resolve the blocked doctor checks before continuing.'},blockers,references:[]});
      return {code:report.ready?0:3,json,envelope};
    }catch(error) {
      const label=planning?'platform.plan':command==='doctor'?'doctor':'unknown';
      if(error instanceof PlanningBlockedError)return {code:3,json,envelope:PlatformSchemas.envelope.parse({command:label,success:false,result:null,problem:{code:'PLANNING_BLOCKED',title:'Planning is blocked',detail:'Resolve the reported blockers before planning again.'},blockers:error.blockers,references:[]})};
      if(error instanceof ArgumentProblem)return this.failure(label,2,json,'INVALID_ARGUMENTS','Invalid arguments. Run trsd --help for supported arguments.');
      return this.failure(label,1,json,'RUNTIME_FAILURE','The requested operation failed unexpectedly. Check local prerequisites and run trsd --help.');
    }
  }
  private success(command:string,result:CliEnvelope['result']):CliExecution {return {code:0,json:false,envelope:PlatformSchemas.envelope.parse({command,success:true,result,problem:null,blockers:[],references:[]})};}
  private failure(command:string,code:1|2|3,json:boolean,problemCode:string,detail:string):CliExecution {return {code,json,envelope:PlatformSchemas.envelope.parse({command,success:false,result:null,problem:{code:problemCode,title:problemCode,detail},blockers:[],references:[]})};}
  static async start():Promise<void> {if(import.meta.main){const result=await new CliApplication().execute(process.argv.slice(2));new CliOutput().write(result);process.exitCode=result.code;}}
}
export class CliOutput {
  write(result:CliExecution):void {
    const envelope=result.envelope;
    if(result.json){process.stdout.write(JSON.stringify(envelope)+'\n');return;}
    if(envelope.result&&'help' in envelope.result){process.stdout.write(envelope.result.help+'\n');return;}
    if(envelope.result&&'version' in envelope.result){process.stdout.write('trsd '+envelope.result.version+'\n');return;}
    if(envelope.result&&'checks' in envelope.result) {
      for(const check of envelope.result.checks)process.stdout.write(`${check.status}: ${check.id} [${check.code}] ${check.message}\n`);
    }
    if(envelope.result&&'id' in envelope.result){process.stdout.write(`Plan ${envelope.result.id} (${envelope.result.digest}) saved. Future effects only.\n`);process.stdout.write(`Origin: ${envelope.result.configuration.origin}\nEngine: ${envelope.result.expectedEngine.context} (${envelope.result.expectedEngine.daemonId})\n`);for(const [name,service] of Object.entries(envelope.result.recipe.services)){process.stdout.write(`Service ${name}: ${service.image}\n`);for(const mount of service.volumes??[])process.stdout.write(`  Volume ${mount.source} -> ${mount.target}\n`);for(const port of service.ports??[])process.stdout.write(`  Port ${port.host_ip}:${port.published} -> ${port.target}/tcp\n`);}for(const effect of envelope.result.effects)process.stdout.write(`${effect.kind}: ${effect.target}\n`);for(const reference of envelope.references)process.stdout.write(reference+'\n');}
    for(const blocker of envelope.blockers)if(envelope.command==='platform.plan')process.stderr.write(`${blocker.code}: ${blocker.message}\n`);
    if(envelope.problem)process.stderr.write(`${envelope.problem.code}: ${envelope.problem.detail}\n`);
  }
}
await CliApplication.start();
