import {mkdtempSync,rmSync,mkdirSync,copyFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,type SpawnSyncReturns} from 'node:child_process';
import {createServer,type Server} from 'node:net';
export class CliProgramFixture {
  readonly root=mkdtempSync(join(tmpdir(),'cordis cli '));
  readonly cwd=join(this.root,'foreign cwd');
  readonly binary=join(this.root,'path with spaces','trsd');
  readonly symlink=join(this.root,'trsd-link');
  constructor() {mkdirSync(this.cwd);mkdirSync(join(this.root,'path with spaces'));copyFileSync(resolve('dist/trsd-linux-x64'),this.binary);symlinkSync(this.binary,this.symlink);}
  run(args:string[],environment:NodeJS.ProcessEnv={},binary=this.binary):SpawnSyncReturns<string> {return spawnSync(binary,args,{cwd:this.cwd,env:{...process.env,...environment},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});}
  close():void {rmSync(this.root,{recursive:true,force:true});}
}
export class CliNetworkFixture {
  server:Server|null=null;
  resolvePort:((port:number)=>void)|null=null;
  listen(resolvePort:(port:number)=>void):void {this.resolvePort=resolvePort;this.server=createServer();this.server.listen(0,'127.0.0.1',this.listening.bind(this));}
  listening():void {const address=this.server!.address();if(address&&typeof address==='object')this.resolvePort!(address.port);}
  async port(occupied=false):Promise<number> {const port=await new Promise<number>(this.listen.bind(this));if(!occupied)this.server!.close();return port;}

}
