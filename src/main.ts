import { DeploymentComposition, DeploymentCapability, type DeploymentHost } from '@treeseed-cordis/deployment';
import { PlatformSchemas, CapabilityToken, ProviderSchemas, type CliEnvelope, type DiagnosticConfiguration, type DeploymentConfiguration, type ProviderArtifact, type ProviderDeclaration, PlanningBlockedError } from '@treeseed-cordis/sdk';
import { Context, CordisComposition, CordisServiceLocator, CompositionError, InstalledProviderLoader, type CompositionHandle, type ProviderLease, type ProviderRegistration } from '@treeseed-cordis/sdk/runtime';
import { openSync, fstatSync, readFileSync, closeSync, constants } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, visit, type ParseError } from 'jsonc-parser';
interface ConfigurationReader {read(path:string):DeploymentConfiguration;}
interface CommandService {execute(args:string[]):Promise<CliExecution>;}
interface OutputService {render(result:CliExecution):RenderedOutput;}
interface RenderedOutput {stdout:string;stderr:string;}
export interface CliExecution {code:0|1|2|3;json:boolean;envelope:CliEnvelope;}
class ArgumentProblem extends Error {}
export class CliArguments {
  static readonly help='Usage: trsd --help | --version | doctor [--json] [--context NAME] [--installation ABSOLUTE_PATH] [--port INTEGER] | platform plan --file CONFIG [--json] [--composition ABSOLUTE_MANIFEST --composition-digest SHA256]';
  static readonly unsupported=['platform','plan','apply','status','install','uninstall','update','open','recover','events','cancel','application','development'];
  static plan(args:string[],files:ConfigurationReader):DeploymentConfiguration {
    const seen=new Set<string>();let file:string|null=null;
    for(let index=2;index<args.length;index++){const flag=args[index]!;if(seen.has(flag))throw new ArgumentProblem();seen.add(flag);if(flag==='--json')continue;if(flag!=='--file')throw new ArgumentProblem();const value=args[++index];if(!value||value.startsWith('-'))throw new ArgumentProblem();file=resolve(value);}
    if(!file)throw new ArgumentProblem();return files.read(file);
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
class ConfigurationFile implements ConfigurationReader {
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
class CliCommands implements CommandService {
  constructor(private readonly context:Context) {}
  async execute(args:string[]):Promise<CliExecution> {
    const command=args[0]??'--help',planning=command==='platform'&&args[1]==='plan',json=(command==='doctor'||planning)&&args.includes('--json');
    let hostLease:ProviderLease<DeploymentHost>|undefined,configurationLease:ProviderLease<ConfigurationReader>|undefined;
    try {
      const locator=CordisServiceLocator.from(this.context);hostLease=await locator.acquire(DeploymentCapability);configurationLease=await locator.acquire(ConfigurationCapability);const host=hostLease.value,files=configurationLease.value;
      if((command==='--help'||command==='help')&&args.length<=1)return this.success('help',{help:CliArguments.help});
      if(command==='--version'&&args.length===1)return this.success('version',{version:'0.0.0-cordis.3'});
      if(planning){const plan=await host.plan(CliArguments.plan(args,files));return {code:0,json,envelope:PlatformSchemas.envelope.parse({command:'platform.plan',success:true,result:plan,problem:null,blockers:[],references:[join(plan.configuration.installationDirectory,'.cordis/plans',plan.id+'.json')]})};}
      if(CliArguments.unsupported.includes(command))return this.failure('unsupported',3,false,'UNSUPPORTED_COMMAND','This executable supports help, version, doctor and platform plan. Run trsd --help.');
      if(command!=='doctor')throw new ArgumentProblem();
      const configuration=CliArguments.doctor(args),report=await host.diagnose(configuration);
      const blockers=[];for(const check of report.checks)if(check.status==='blocked')blockers.push({code:check.code,message:check.message});
      const envelope=PlatformSchemas.envelope.parse({command:'doctor',success:report.ready,result:report,problem:report.ready?null:{code:'PREREQUISITES_UNMET',title:'Host prerequisites are unmet',detail:'Resolve the blocked doctor checks before continuing.'},blockers,references:[]});
      return {code:report.ready?0:3,json,envelope};
    }catch(error) {
      const label=planning?'platform.plan':command==='doctor'?'doctor':'unknown';
      if(error instanceof PlanningBlockedError)return {code:3,json,envelope:PlatformSchemas.envelope.parse({command:label,success:false,result:null,problem:{code:'PLANNING_BLOCKED',title:'Planning is blocked',detail:'Resolve the reported blockers before planning again.'},blockers:error.blockers,references:[]})};
      if(error instanceof ArgumentProblem)return this.failure(label,2,json,'INVALID_ARGUMENTS','Invalid arguments. Run trsd --help for supported arguments.');
      return this.failure(label,1,json,'RUNTIME_FAILURE','The requested operation failed unexpectedly. Check local prerequisites and run trsd --help.');
    }finally{await configurationLease?.release();await hostLease?.release();}
  }
  private success(command:string,result:CliEnvelope['result']):CliExecution {return {code:0,json:false,envelope:PlatformSchemas.envelope.parse({command,success:true,result,problem:null,blockers:[],references:[]})};}
  private failure(command:string,code:1|2|3,json:boolean,problemCode:string,detail:string):CliExecution {return {code,json,envelope:PlatformSchemas.envelope.parse({command,success:false,result:null,problem:{code:problemCode,title:problemCode,detail},blockers:[],references:[]})};}
}
export class CliOutput implements OutputService {
  render(result:CliExecution):RenderedOutput {
    const envelope=result.envelope,stdout:string[]=[],stderr:string[]=[];
    if(result.json)return {stdout:JSON.stringify(envelope)+'\n',stderr:''};
    if(envelope.result&&'help' in envelope.result)return {stdout:envelope.result.help+'\n',stderr:''};
    if(envelope.result&&'version' in envelope.result)return {stdout:'trsd '+envelope.result.version+'\n',stderr:''};
    if(envelope.result&&'checks' in envelope.result)for(const check of envelope.result.checks)stdout.push(`${check.status}: ${check.id} [${check.code}] ${check.message}`);
    if(envelope.result&&'id' in envelope.result){stdout.push(`Plan ${envelope.result.id} (${envelope.result.digest}) saved. Future effects only.`,`Origin: ${envelope.result.configuration.origin}`,`Engine: ${envelope.result.expectedEngine.context} (${envelope.result.expectedEngine.daemonId})`);for(const [name,service] of Object.entries(envelope.result.recipe.services)){stdout.push(`Service ${name}: ${service.image}`);for(const mount of service.volumes??[])stdout.push(`  Volume ${mount.source} -> ${mount.target}`);for(const port of service.ports??[])stdout.push(`  Port ${port.host_ip}:${port.published} -> ${port.target}/tcp`);}for(const effect of envelope.result.effects)stdout.push(`${effect.kind}: ${effect.target}`);stdout.push(...envelope.references);}
    for(const blocker of envelope.blockers)if(envelope.command==='platform.plan')stderr.push(`${blocker.code}: ${blocker.message}`);
    if(envelope.problem)stderr.push(`${envelope.problem.code}: ${envelope.problem.detail}`);
    return {stdout:stdout.length?stdout.join('\n')+'\n':'',stderr:stderr.length?stderr.join('\n')+'\n':''};
  }
  write(result:CliExecution):void {NativeStreams.write(this.render(result));}
}
class NativeStreams {static write(output:RenderedOutput):void {if(output.stdout)process.stdout.write(output.stdout);if(output.stderr)process.stderr.write(output.stderr);}}
class CapabilityValidation<T extends object> {
  constructor(private readonly method:string){}
  parse(value:unknown):T {if(!value||typeof Reflect.get(value as object,this.method)!=='function')throw new Error('Invalid CLI adapter');return value as T;}
}
const ConfigurationCapability=new CapabilityToken<ConfigurationReader>('cli.configuration','0.3.0-cordis.1',new CapabilityValidation('read'));
const CommandCapability=new CapabilityToken<CommandService>('cli.commands','0.3.0-cordis.1',new CapabilityValidation('execute'));
const OutputCapability=new CapabilityToken<OutputService>('cli.output','0.3.0-cordis.1',new CapabilityValidation('render'));
class CoreDeclarations {static define(id:string,capability:string,inject:string[]=[]):ProviderDeclaration {return ProviderSchemas.declaration.parse({id,pluginId:'cli',capability,contractVersion:'0.3.0-cordis.1',target:'cli',provide:[capability],inject});}}
class ConfigurationPlugin {
  static readonly declaration=CoreDeclarations.define('json-file','cli.configuration');static readonly provide=this.declaration.provide;static readonly inject=this.declaration.inject;static readonly Config=PlatformSchemas.empty;
  constructor(context:Context){context.provide(ConfigurationCapability.id,new ConfigurationFile());}
}
class CommandsPlugin {
  static readonly declaration=CoreDeclarations.define('core-commands','cli.commands',['cordis.composition','deployment','cli.configuration']);static readonly provide=this.declaration.provide;static readonly inject=this.declaration.inject;static readonly Config=PlatformSchemas.empty;
  constructor(context:Context){context.provide(CommandCapability.id,new CliCommands(context));}
}
class OutputPlugin {
  static readonly declaration=CoreDeclarations.define('terminal','cli.output');static readonly provide=this.declaration.provide;static readonly inject=this.declaration.inject;static readonly Config=PlatformSchemas.empty;
  constructor(context:Context){context.provide(OutputCapability.id,new CliOutput());}
}
class Invocation {context:Context|null=null;}
class InvocationPlugin {static readonly inject=['cordis.composition','cli.commands','cli.output'];constructor(context:Context,invocation:Invocation){invocation.context=context;}}
class CliComposition {
  static core(artifact:ProviderArtifact):ProviderRegistration[] {return [{token:ConfigurationCapability,plugin:ConfigurationPlugin,declaration:ConfigurationPlugin.declaration,configuration:{},artifact},{token:CommandCapability,plugin:CommandsPlugin,declaration:CommandsPlugin.declaration,configuration:{},artifact},{token:OutputCapability,plugin:OutputPlugin,declaration:OutputPlugin.declaration,configuration:{},artifact}];}
  static selections(scopeId:string):Array<{scopeId:string;capability:string;providerId:string}> {return [{scopeId,capability:'cli.configuration',providerId:'json-file'},{scopeId,capability:'cli.commands',providerId:'core-commands'},{scopeId,capability:'cli.output',providerId:'terminal'}];}
  static prepared(args:string[]):{args:string[];file:string|null;digest:string|null} {
    const result:string[]=[],seen=new Set<string>();let file:string|null=null,digest:string|null=null;
    for(let index=0;index<args.length;index++){const flag=args[index]!;if(flag!=='--composition'&&flag!=='--composition-digest'){result.push(flag);continue;}if(seen.has(flag))throw new ArgumentProblem();seen.add(flag);const value=args[++index];if(!value||value.startsWith('-'))throw new ArgumentProblem();if(flag==='--composition'){if(!isAbsolute(value))throw new ArgumentProblem();file=value;}else {if(!/^[a-f0-9]{64}$/.test(value))throw new ArgumentProblem();digest=value;}}
    if((file===null)!==(digest===null))throw new ArgumentProblem();if(file&&result[0]!=='doctor'&&!(result[0]==='platform'&&result[1]==='plan'))throw new ArgumentProblem();return {args:result,file,digest};
  }
}
export class CliApplication {
  async execute(args:string[]):Promise<CliExecution> {return this.invoke(args,false);}
  private async invoke(args:string[],emit:boolean):Promise<CliExecution> {
    const planning=args[0]==='platform'&&args[1]==='plan',json=(args[0]==='doctor'||planning)&&args.includes('--json');
    let handle:CompositionHandle|null=null,result:CliExecution,output:RenderedOutput;
    try {
      const prepared=CliComposition.prepared(args),scopeId='local-cli',artifact:ProviderArtifact={kind:'bundled',identity:'sha256:'+createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
      let registrations=DeploymentComposition.registrations(artifact);const selections=DeploymentComposition.selections(scopeId);
      if(prepared.file&&prepared.digest){const registration=await InstalledProviderLoader.load(prepared.file,prepared.digest,DeploymentCapability,'cli',scopeId);registrations=registrations.filter(CliApplication.notDeployment);registrations.push(registration);for(const selection of selections)if(selection.capability==='deployment')selection.providerId=ProviderSchemas.declaration.parse(registration.declaration).id;}
      registrations.push(...CliComposition.core(artifact));selections.push(...CliComposition.selections(scopeId));
      handle=await CordisComposition.start({registrations,selections},{scopeId,target:'cli',principalId:'uid:'+String(process.getuid?.()??process.pid),resourceScope:'local-owner'});
      const invocation=new Invocation();await handle.mount(InvocationPlugin,invocation);const locator=CordisServiceLocator.from(invocation.context!),commands=await locator.acquire(CommandCapability),renderer=await locator.acquire(OutputCapability);
      try {result=await commands.value.execute(prepared.args);output=renderer.value.render(result);}finally{await renderer.release();await commands.release();}
      await handle.dispose();handle=null;
    }catch(error){if(handle)try{await handle.dispose();}catch{}const code=error instanceof ArgumentProblem?2:error instanceof CompositionError&&error.code!=='PROVIDER_LIFECYCLE'?3:1;const problemCode=code===2?'INVALID_ARGUMENTS':code===3?'COMPOSITION_BLOCKED':'RUNTIME_FAILURE';result={code,json,envelope:PlatformSchemas.envelope.parse({command:planning?'platform.plan':args[0]==='doctor'?'doctor':'unknown',success:false,result:null,problem:{code:problemCode,title:problemCode,detail:'The requested command could not complete. Check the selected provider and run trsd --help.'},blockers:code===3?[{code:'COMPOSITION_BLOCKED',message:'The prepared provider or composition was rejected.'}]:[],references:[]})};output=json?{stdout:JSON.stringify(result.envelope)+'\n',stderr:''}:{stdout:'',stderr:problemCode+': '+result.envelope.problem!.detail+'\n'};}
    if(emit)NativeStreams.write(output);return result;
  }
  private static notDeployment(registration:ProviderRegistration):boolean {return registration.token.id!=='deployment';}
  static async start():Promise<void> {if(import.meta.main){const result=await new CliApplication().invoke(process.argv.slice(2),true);process.exitCode=result.code;}}
}
await CliApplication.start();
