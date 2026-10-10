// Unit-test OS boundary. Real systemd user sealing is accepted separately on the supported host.
import childProcess, { type ExecFileSyncOptions } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
const actual=childProcess.execFileSync;
const key=createHash('sha256').update('synthetic-unit-test-os-boundary').digest();
childProcess.execFileSync=((file: string, args: readonly string[], options: ExecFileSyncOptions) => {
  if(file!=='/usr/bin/systemd-creds')return actual(file,[...args],options);
  const raw=options.input;
  if(raw===undefined)throw new TypeError('OS credential test input is required');
  const input=typeof raw==='string'?Buffer.from(raw):Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength);
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
}) as typeof actual;
syncBuiltinESMExports();
