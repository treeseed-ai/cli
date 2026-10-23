import { ComposeDeploymentHost, type DeploymentHost } from '@treeseed-cordis/deployment';
import { PlatformSchemas, type CliEnvelope, type DiagnosticConfiguration, type DiagnosticReport } from '@treeseed-cordis/sdk';

export interface CliExecution {code:0|1|2|3;json:boolean;envelope:CliEnvelope;}
class ArgumentProblem extends Error {}
export class CliArguments {
  static readonly help='Usage: trsd --help | --version | doctor [--json] [--context NAME] [--installation ABSOLUTE_PATH] [--port INTEGER]';
  static readonly unsupported=['platform','plan','apply','status','install','uninstall','update','open','recover','events','cancel','application','development'];
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
export class CliApplication {
  constructor(private readonly host:DeploymentHost=new ComposeDeploymentHost()) {}
  async execute(args:string[]):Promise<CliExecution> {
    const command=args[0]??'--help',json=command==='doctor'&&args.includes('--json');
    try {
      if((command==='--help'||command==='help')&&args.length<=1)return this.success('help',{help:CliArguments.help});
      if(command==='--version'&&args.length===1)return this.success('version',{version:'0.0.0-cordis.1'});
      if(CliArguments.unsupported.includes(command))return this.failure('unsupported',3,false,'UNSUPPORTED_COMMAND','This Task 1 executable supports help, version and doctor. Run trsd --help.');
      if(command!=='doctor')throw new ArgumentProblem();
      const configuration=CliArguments.doctor(args),report=await this.host.diagnose(configuration);
      const blockers=[];for(const check of report.checks)if(check.status==='blocked')blockers.push({code:check.code,message:check.message});
      const envelope=PlatformSchemas.envelope.parse({command:'doctor',success:report.ready,result:report,problem:report.ready?null:{code:'PREREQUISITES_UNMET',title:'Host prerequisites are unmet',detail:'Resolve the blocked doctor checks before continuing.'},blockers,references:[]});
      return {code:report.ready?0:3,json,envelope};
    }catch(error) {
      if(error instanceof ArgumentProblem)return this.failure(command==='doctor'?'doctor':'unknown',2,json,'INVALID_ARGUMENTS','Invalid arguments. Run trsd --help for supported arguments.');
      return this.failure(command==='doctor'?'doctor':'unknown',1,json,'RUNTIME_FAILURE','Diagnostics failed unexpectedly. Check local prerequisites and run trsd --help.');
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
    if(envelope.problem)process.stderr.write(`${envelope.problem.code}: ${envelope.problem.detail}\n`);
  }
}
await CliApplication.start();
