// Unit-test OS boundary. Real systemd user sealing is accepted separately on the supported host.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
const actual=childProcess.execFileSync;
const key=createHash('sha256').update('synthetic-unit-test-os-boundary').digest();
childProcess.execFileSync=function(file,args,options){
  if(file!=='/usr/bin/systemd-creds')return actual.call(this,file,args,options);
  const input=Buffer.from(options.input);
  if(args[0]==='encrypt'){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    const bytes=Buffer.concat([cipher.update(input),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),bytes]);
  }
  if(args[0]==='decrypt'){
    const cipher=createDecipheriv('aes-256-gcm',key,input.subarray(0,12));cipher.setAuthTag(input.subarray(12,28));
    return Buffer.concat([cipher.update(input.subarray(28)),cipher.final()]);
  }
  throw new Error('Unexpected OS credential test operation');
};
syncBuiltinESMExports();
