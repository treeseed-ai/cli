import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import type { DevelopmentRuntime } from '@treeseed/sdk/development';
import { candidateFixture } from '../support/development-candidate.ts';

function configure(fixture:ReturnType<typeof candidateFixture>,change:(document:{development:DevelopmentRuntime})=>void) {
	const path=resolve(fixture.root,'treeseed.package.yaml'),document=parse(readFileSync(path,'utf8'));
	change(document);writeFileSync(path,stringify(document));
}
function command(fixture:ReturnType<typeof candidateFixture>,file:string,cwd?:string) {
	return {command:'node',args:['--import',import.meta.resolve('tsx'),resolve(fixture.root,`scripts/${file}.ts`)],environment:{},timeoutSeconds:60,...(cwd?{cwd}:{})};
}
function expectBlocked(fixture:ReturnType<typeof candidateFixture>) {
	assert.match(fixture.output.join(''),/working directory custody/);
	assert.equal(fixture.registrations.length,0);
}

test('native freeze rejects an escaped command directory before executing its actual subprocess',async()=>{
	const fixture=candidateFixture(),external=candidateFixture();
	try {
		symlinkSync(external.root,resolve(fixture.root,'working'));
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),`import {writeFileSync} from 'node:fs'; writeFileSync('executed.outside','bad'); writeFileSync(${JSON.stringify(resolve(fixture.root,'candidate.bin'))},'sealed');\n`);
		configure(fixture,d=>{d.development.targets[0].freeze!.operation=command(fixture,'freeze','working');});
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join(''));expectBlocked(fixture);
		assert.equal(existsSync(resolve(external.root,'executed.outside')),false);
		assert.equal(existsSync(resolve(fixture.root,'candidate.bin')),false);
	} finally {fixture.close();external.close();}
});
test('native freeze preflights escaped contract directories before its otherwise valid build',async()=>{
	const fixture=candidateFixture(),external=candidateFixture();
	try {
		symlinkSync(external.root,resolve(fixture.root,'working'));
		writeFileSync(resolve(fixture.root,'scripts/contract.ts'),"import {writeFileSync} from 'node:fs'; writeFileSync('executed.outside','bad');\n");
		configure(fixture,d=>{d.development.targets[0].freeze!.contractOperations=[command(fixture,'contract','working')];});
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join(''));expectBlocked(fixture);
		assert.equal(existsSync(resolve(fixture.root,'candidate.bin')),false);
		assert.equal(existsSync(resolve(external.root,'executed.outside')),false);
	} finally {fixture.close();external.close();}
});
test('native freeze preflights every selected target directory before any native build',async()=>{
	const fixture=candidateFixture(),external=candidateFixture();
	try {
		symlinkSync(external.root,resolve(fixture.root,'working'));
		configure(fixture,d=>{const first=d.development.targets[0]!;d.development.targets.push({...first,id:'second',freeze:{...first.freeze!,operation:command(fixture,'second','working'),artifacts:['second.bin']}});});
		writeFileSync(resolve(fixture.root,'scripts/second.ts'),`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(resolve(fixture.root,'second.bin'))},'second');\n`);
		writeFileSync(resolve(fixture.root,'development.session.yaml'),'projects:\n  - manifest: treeseed.package.yaml\n    worktree: .\n    targets: [{id: package, mode: candidate}, {id: second, mode: candidate}]\n');
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join(''));expectBlocked(fixture);
		assert.equal(existsSync(resolve(fixture.root,'candidate.bin')),false);
		assert.equal(existsSync(resolve(fixture.root,'second.bin')),false);
	} finally {fixture.close();external.close();}
});
test('native candidate verification rejects an escaped directory before its actual verifier',async()=>{
	const fixture=candidateFixture(),external=candidateFixture();
	try {
		symlinkSync(external.root,resolve(fixture.root,'working'));
		configure(fixture,d=>{d.development.targets[0].operations.verify=command(fixture,'verify','working');});
		const frozen=await fixture.freeze();
		assert.equal(await fixture.verify(),1,fixture.output.join(''));
		assert.match(fixture.output.join(''),/working directory custody/);
		assert.equal(existsSync(resolve(external.root,'verification.log')),false);
		assert.equal(fixture.registrations.length,1);
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'pending');
	} finally {fixture.close();external.close();}
});
test('native candidate verification preflights every verifier directory before the first native command',async()=>{
	const fixture=candidateFixture(),external=candidateFixture();
	try {
		symlinkSync(external.root,resolve(fixture.root,'working'));
		configure(fixture,d=>{const first=d.development.targets[0]!;d.development.targets.push({...first,id:'second',operations:{verify:command(fixture,'verify','working')},freeze:{...first.freeze!,operation:command(fixture,'second'),artifacts:['second.bin']}});});
		writeFileSync(resolve(fixture.root,'scripts/second.ts'),"import {writeFileSync} from 'node:fs'; writeFileSync('second.bin','second');\n");
		writeFileSync(resolve(fixture.root,'development.session.yaml'),'projects:\n  - manifest: treeseed.package.yaml\n    worktree: .\n    targets: [{id: package, mode: candidate}, {id: second, mode: candidate}]\n');
		const frozen=await fixture.freeze();assert.equal(await fixture.verify(),1,fixture.output.join(''));
		assert.match(fixture.output.join(''),/working directory custody/);
		assert.equal(existsSync(resolve(fixture.root,'verification.log')),false);
		assert.equal(existsSync(resolve(external.root,'verification.log')),false);
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'pending');
		assert.equal(fixture.registrations.length,1);
	} finally {fixture.close();external.close();}
});
test('native candidate commands preserve contained directory aliases and exact working-directory execution',async()=>{
	const fixture=candidateFixture();
	try {
		symlinkSync('scripts',resolve(fixture.root,'working'));
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),`import {writeFileSync} from 'node:fs'; if(process.cwd()!==${JSON.stringify(resolve(fixture.root,'scripts'))})throw Error('wrong cwd'); writeFileSync(${JSON.stringify(resolve(fixture.root,'candidate.bin'))},'sealed');\n`);
		writeFileSync(resolve(fixture.root,'scripts/verify.ts'),`import {appendFileSync} from 'node:fs'; if(process.cwd()!==${JSON.stringify(resolve(fixture.root,'scripts'))})throw Error('wrong cwd'); appendFileSync(${JSON.stringify(resolve(fixture.root,'verification.log'))},'verified\\n');\n`);
		configure(fixture,d=>{d.development.targets[0].freeze!.operation=command(fixture,'freeze','working');d.development.targets[0].operations.verify=command(fixture,'verify','working');});
		const frozen=await fixture.freeze();assert.equal(await fixture.verify(),0,fixture.output.join(''));
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'passed');
		assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'verified\n');
	} finally {fixture.close();}
});
for(const kind of ['freeze','verify'] as const) {
	test(`native ${kind} rejects ignored command directory movement after one actual execution`,async()=>{
		const fixture=candidateFixture(),external=candidateFixture();
		try {
			writeFileSync(resolve(fixture.root,'.gitignore'),'working\nverification.log\n');
			symlinkSync('scripts',resolve(fixture.root,'working'));
			const script=`import {appendFileSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs'; appendFileSync(${JSON.stringify(resolve(fixture.root,'verification.log'))},'ran\\n'); ${kind==='freeze'?`writeFileSync(${JSON.stringify(resolve(fixture.root,'candidate.bin'))},'sealed');`:''} unlinkSync(${JSON.stringify(resolve(fixture.root,'working'))}); symlinkSync(${JSON.stringify(external.root)},${JSON.stringify(resolve(fixture.root,'working'))});\n`;
			writeFileSync(resolve(fixture.root,`scripts/${kind}.ts`),script);
			configure(fixture,d=>{if(kind==='freeze')d.development.targets[0].freeze!.operation=command(fixture,kind,'working');else d.development.targets[0].operations.verify=command(fixture,kind,'working');});
			if(kind==='freeze'){assert.equal(await fixture.tryFreeze(),1,fixture.output.join(''));expectBlocked(fixture);}
			else {const frozen=await fixture.freeze();assert.equal(await fixture.verify(),1,fixture.output.join(''));assert.match(fixture.output.join(''),/working directory custody/);assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'pending');assert.equal(fixture.registrations.length,1);}
			assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'ran\n');
		} finally {fixture.close();external.close();}
	});
}
