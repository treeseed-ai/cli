import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { candidateFixture } from '../support/development-candidate.ts';

test('native freeze rejects escaped artifact bytes before persisting or registering a candidate',async()=>{
	const fixture=candidateFixture(),external=mkdtempSync(resolve(tmpdir(),'cli-freeze-external-'));
	try {
		const outside=resolve(external,'sealed');writeFileSync(outside,'sealed');
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),`import {symlinkSync} from 'node:fs';symlinkSync(${JSON.stringify(outside)},'candidate.bin');\n`);
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join(''));
		assert.equal(fixture.registrations.length,0);assert.match(fixture.output.join(''),/artifact/i);
		assert.equal(readFileSync(outside,'utf8'),'sealed');
	}finally{fixture.close();rmSync(external,{recursive:true,force:true});}
});

test('native candidate verification rejects escaped identical artifact bytes before its verifier',async()=>{
	const fixture=candidateFixture(),external=mkdtempSync(resolve(tmpdir(),'cli-verify-external-'));
	try {
		const frozen=await fixture.freeze(),receipt=readFileSync(frozen.receipt,'utf8'),outside=resolve(external,'sealed');
		writeFileSync(outside,'sealed');rmSync(resolve(fixture.root,'candidate.bin'));symlinkSync(outside,resolve(fixture.root,'candidate.bin'));
		assert.equal(await fixture.verify(),1,fixture.output.join(''));
		assert.equal(existsSync(resolve(fixture.root,'verification.log')),false);
		assert.equal(fixture.registrations.length,1);assert.equal(readFileSync(frozen.receipt,'utf8'),receipt);
		assert.equal(readFileSync(outside,'utf8'),'sealed');
	}finally{fixture.close();rmSync(external,{recursive:true,force:true});}
});

test('native owned artifact aliases preserve regular output verification and dirty candidate rules',async()=>{
	const fixture=candidateFixture();
	try {
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),"import {writeFileSync,symlinkSync} from 'node:fs';writeFileSync('ignored.bin','sealed');symlinkSync('ignored.bin','candidate.bin');\n");
		const frozen=await fixture.freeze();assert.equal(await fixture.verify(),0,fixture.output.join(''));
		assert.equal(fixture.registrations.length,2);assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'passed');
		assert.equal(fixture.readReceipt(frozen.receipt).promotable,false);assert.equal(readFileSync(resolve(fixture.root,'ignored.bin'),'utf8'),'sealed');
	}finally{fixture.close();}
});

test('native candidate verification rejects identical escaped artifact bytes after its owned command',async()=>{
	const fixture=candidateFixture(),external=mkdtempSync(resolve(tmpdir(),'cli-artifact-between-'));
	try {
		const outside=resolve(external,'sealed');writeFileSync(outside,'sealed');
		writeFileSync(resolve(fixture.root,'scripts/verify.ts'),`import {appendFileSync,rmSync,symlinkSync} from 'node:fs';appendFileSync('verification.log','verified\\n');rmSync('candidate.bin');symlinkSync(${JSON.stringify(outside)},'candidate.bin');\n`);
		const frozen=await fixture.freeze(),receipt=readFileSync(frozen.receipt,'utf8');assert.equal(await fixture.verify(),1,fixture.output.join(''));
		assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'verified\n');assert.equal(fixture.registrations.length,1);
		assert.equal(readFileSync(frozen.receipt,'utf8'),receipt);assert.equal(readFileSync(outside,'utf8'),'sealed');
	}finally{fixture.close();rmSync(external,{recursive:true,force:true});}
});

test('native freeze rejects FIFO output promptly without a registered candidate or retained lock',()=>{
	const code=`import {writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {candidateFixture} from ${JSON.stringify(import.meta.resolve('../support/development-candidate.ts'))};const fixture=candidateFixture();console.log(JSON.stringify({root:fixture.root,state:fixture.state}));try{writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),"import {execFileSync} from 'node:child_process';execFileSync('mkfifo',['candidate.bin']);\\n");const status=await fixture.tryFreeze();console.log(JSON.stringify({status,registrations:fixture.registrations.length,output:fixture.output}));}finally{fixture.close();}`;
	const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),'--input-type=module','-e',code],{encoding:'utf8',timeout:4000});
	const lines=result.stdout.trim().split('\n'),roots=JSON.parse(lines[0]!) as {root:string;state:string};
	try {
		assert.equal(result.error,undefined,'Public freeze must reject FIFO rather than hang');assert.equal(result.status,0,result.stderr);
		const outcome=JSON.parse(lines.at(-1)!);assert.equal(outcome.status,1);assert.equal(outcome.registrations,0);assert.match(outcome.output.join(''),/artifact/i);
		assert.equal(existsSync(roots.root),false);assert.equal(existsSync(roots.state),false);
	}finally{
		for(const [path,prefix] of [[roots.root,'cli-source-closure-'],[roots.state,'cli-source-state-']]) {
			assert.ok(path!.startsWith(resolve(tmpdir(),prefix)));rmSync(path!,{recursive:true,force:true});
		}
	}
});
