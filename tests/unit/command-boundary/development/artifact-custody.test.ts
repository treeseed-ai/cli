import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { developmentRuntimeSchema } from '@treeseed/sdk/development';
import { freezeCustody } from '../../../../src/cli/commands/development-support/candidate.ts';
import { candidateFixture } from '../../../support/development-candidate.ts';

for(const kind of ['escaped','directory','unreadable','fifo','broken','contained','regular'] as const) {
	test(`artifact custody ${kind==='regular'||kind==='contained'?'admits':'rejects'} ${kind} bytes through the existing freeze boundary`,()=>{
		const fixture=candidateFixture(),external=mkdtempSync(resolve(tmpdir(),'cli-artifact-external-'));
		try {
			const runtime=developmentRuntimeSchema.parse(parse(readFileSync(resolve(fixture.root,'treeseed.package.yaml'),'utf8')).development);
			const record={session:{repositories:[{projectId:'specimen',worktree:fixture.root}],targets:[{projectId:'specimen',targetId:'package',mode:'candidate'}]},runtimes:[runtime]};
			const path=resolve(fixture.root,'candidate.bin'),outside=resolve(external,'sealed');writeFileSync(outside,'sealed');
			if(kind==='contained')writeFileSync(resolve(fixture.root,'ignored.bin'),'sealed');
			const custody=freezeCustody(record);
			if(kind==='escaped')symlinkSync(outside,path);
			else if(kind==='contained')symlinkSync('ignored.bin',path);
			else if(kind==='broken')symlinkSync('missing.bin',path);
			else if(kind==='directory')mkdirSync(path);
			else if(kind==='fifo')execFileSync('mkfifo',[path]);
			else {writeFileSync(path,'sealed');if(kind==='unreadable')chmodSync(path,0o000);}
			const artifacts=[{projectId:'specimen',identity:'candidate.bin',digest:`sha256:${createHash('sha256').update('sealed').digest('hex')}`}];
			if(kind==='fifo') {
				const code=`import {freezeCustody} from ${JSON.stringify(import.meta.resolve('../../../../src/cli/commands/development-support/candidate.ts'))};try {freezeCustody(${JSON.stringify(record)}).assert(${JSON.stringify(artifacts)});process.exitCode=2;}catch(error){console.log(String(error));}`;
				const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),'--input-type=module','-e',code],{encoding:'utf8',timeout:3000});
				assert.equal(result.error,undefined,'FIFO artifact read must not block');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/artifact/i);
			} else if(kind==='regular'||kind==='contained')assert.doesNotThrow(()=>custody.assert(artifacts));
			else assert.throws(()=>custody.assert(artifacts));
			assert.equal(readFileSync(outside,'utf8'),'sealed');
		}finally{fixture.close();rmSync(external,{recursive:true,force:true});}
	});
}
