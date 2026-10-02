import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { candidateFixture } from '../support/development-candidate.ts';

function contract(root:string,code:string) {
	writeFileSync(resolve(root,'scripts/contract.ts'),code);
	const path=resolve(root,'treeseed.package.yaml'),document=parse(readFileSync(path,'utf8'));
	document.development.targets[0].freeze.contractOperations=[{command:'node',args:['--import',import.meta.resolve('tsx'),'scripts/contract.ts'],environment:{},timeoutSeconds:60}];
	writeFileSync(path,stringify(document));
}
function assertNoCandidate(fixture:ReturnType<typeof candidateFixture>) {
	assert.equal(fixture.registrations.length,0);
	const files=(root:string):string[]=>readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(resolve(root,entry.name)):[entry.name]);
	assert.equal(files(fixture.state).some(name=>name.startsWith('candidate-')||name==='freeze.lock'),false);
}

for(const kind of ['tracked','untracked','head','recipe'] as const) {
	test(`native freeze rejects ${kind} mutation before contract execution or candidate registration`,async()=>{
		const fixture=candidateFixture();
		try {
			const mutation=kind==='tracked'?"writeFileSync('scripts/verify.ts','changed');":kind==='untracked'?"writeFileSync('local-source.ts','changed');":kind==='recipe'?"appendFileSync('treeseed.package.yaml','\\n# changed recipe\\n');":"execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','moved']);";
			contract(fixture.root,"import {writeFileSync} from 'node:fs'; writeFileSync('contract-ran','unexpected');\n");
			writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),`import {writeFileSync,appendFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process'; writeFileSync('candidate.bin','sealed'); ${mutation}\n`);
			assert.equal(await fixture.tryFreeze(),1,fixture.output.join(''));
			assert.match(fixture.output.join(''),/source changed during freeze/);
			assert.equal(existsSync(resolve(fixture.root,'contract-ran')),false);
			assertNoCandidate(fixture);
		} finally {fixture.close();}
	});
}

test('native freeze rejects contract source mutation and releases the freeze lock',async()=>{
	const fixture=candidateFixture();
	try {
		contract(fixture.root,"import {writeFileSync} from 'node:fs'; writeFileSync('scripts/verify.ts','changed');\n");
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join('')); assertNoCandidate(fixture);
		assert.match(fixture.output.join(''),/source changed during freeze/);
		writeFileSync(resolve(fixture.root,'scripts/contract.ts'),'export {};\n');
		const frozen=await fixture.freeze();
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'pending');
		assert.equal(fixture.registrations.length,1);
	} finally {fixture.close();}
});

test('native freeze checks every owner after each build before later owner side effects',async()=>{
	const fixture=candidateFixture(),peer=candidateFixture();
	try {
		const manifest=resolve(peer.root,'treeseed.package.yaml'),document=parse(readFileSync(manifest,'utf8'));
		document.development.project.id='peer'; writeFileSync(manifest,stringify(document));
		writeFileSync(resolve(fixture.root,'development.session.yaml'),`projects:\n  - manifest: treeseed.package.yaml\n    worktree: .\n    targets: [{id: package, mode: candidate}]\n  - manifest: ${JSON.stringify(manifest)}\n    worktree: ${JSON.stringify(peer.root)}\n    targets: [{id: package, mode: candidate}]\n`);
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),`import {writeFileSync} from 'node:fs'; writeFileSync('candidate.bin','sealed'); writeFileSync(${JSON.stringify(resolve(peer.root,'scripts/verify.ts'))},'changed');\n`);
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join('')); assertNoCandidate(fixture);
		assert.match(fixture.output.join(''),/source changed during freeze: peer/);
		assert.equal(existsSync(resolve(peer.root,'candidate.bin')),false);
	} finally {fixture.close();peer.close();}
});

test('native freeze rejects earlier artifact mutation by a later owner build',async()=>{
	const fixture=candidateFixture();
	try {
		const path=resolve(fixture.root,'treeseed.package.yaml'),document=parse(readFileSync(path,'utf8'));
		const first=document.development.targets[0];
		document.development.targets.push({...first,id:'second',freeze:{...first.freeze,operation:{...first.freeze.operation,args:['--import',import.meta.resolve('tsx'),'scripts/second.ts']},artifacts:['second.bin']}});
		writeFileSync(path,stringify(document));
		writeFileSync(resolve(fixture.root,'scripts/second.ts'),"import {writeFileSync} from 'node:fs'; writeFileSync('candidate.bin','changed'); writeFileSync('second.bin','sealed second');\n");
		writeFileSync(resolve(fixture.root,'development.session.yaml'),'projects:\n  - manifest: treeseed.package.yaml\n    worktree: .\n    targets: [{id: package, mode: candidate}, {id: second, mode: candidate}]\n');
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join('')); assertNoCandidate(fixture);
		assert.match(fixture.output.join(''),/artifact changed during freeze/);
	} finally {fixture.close();}
});

test('native freeze preserves repeated declared outputs and dirty source without claiming a verification pass',async()=>{
	const fixture=candidateFixture();
	try {
		writeFileSync(resolve(fixture.root,'local-source.ts'),'export {};');
		const first=await fixture.freeze(),second=await fixture.freeze();
		assert.notEqual(first.receipt,second.receipt);
		assert.equal(fixture.readReceipt(second.receipt).promotable,false);
		assert.equal(fixture.readReceipt(second.receipt).verification.status,'pending');
		assert.equal(await fixture.verify(),0,fixture.output.join(''));
		assert.equal(fixture.registrations.length,3);
	} finally {fixture.close();}
});

test('native freeze failure retains partial outputs without persisting or registering a candidate',async()=>{
	const fixture=candidateFixture();
	try {
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),"import {writeFileSync} from 'node:fs'; writeFileSync('candidate.bin','partial'); process.exit(1);\n");
		assert.equal(await fixture.tryFreeze(),1); assertNoCandidate(fixture);
		assert.equal(readFileSync(resolve(fixture.root,'candidate.bin'),'utf8'),'partial');
		assert.match(fixture.output.join(''),/Freeze failed/);
	} finally {fixture.close();}
});

test('native freeze admits new wildcard output directories without treating generated bytes as source',async()=>{
	const fixture=candidateFixture();
	try {
		const path=resolve(fixture.root,'treeseed.package.yaml'),document=parse(readFileSync(path,'utf8'));
		document.development.targets[0].freeze.artifacts=['output/*.bin']; writeFileSync(path,stringify(document));
		writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),"import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync('output',{recursive:true}); writeFileSync('output/candidate.bin','sealed');\n");
		await fixture.freeze(); assert.equal(await fixture.verify(),0,fixture.output.join(''));
		await fixture.freeze(); assert.equal(await fixture.verify(),0,fixture.output.join(''));
		assert.equal(fixture.registrations.length,4);
	} finally {fixture.close();}
});

test('native freeze blocks a target with no declared outputs before executing a later build',async()=>{
	const fixture=candidateFixture();
	try {
		const path=resolve(fixture.root,'treeseed.package.yaml'),document=parse(readFileSync(path,'utf8'));
		const first=document.development.targets[0]; first.freeze.artifacts=['*.first'];
		document.development.targets.push({...first,id:'second',freeze:{...first.freeze,operation:{...first.freeze.operation,args:['--import',import.meta.resolve('tsx'),'scripts/second.ts']},artifacts:['second.bin']}});
		writeFileSync(path,stringify(document)); writeFileSync(resolve(fixture.root,'scripts/freeze.ts'),'export {};\n');
		writeFileSync(resolve(fixture.root,'scripts/second.ts'),"import {writeFileSync} from 'node:fs'; writeFileSync('second.bin','sealed second');\n");
		writeFileSync(resolve(fixture.root,'development.session.yaml'),'projects:\n  - manifest: treeseed.package.yaml\n    worktree: .\n    targets: [{id: package, mode: candidate}, {id: second, mode: candidate}]\n');
		assert.equal(await fixture.tryFreeze(),1,fixture.output.join('')); assertNoCandidate(fixture);
		assert.match(fixture.output.join(''),/Freeze produced no declared artifacts for specimen.package/);
		assert.equal(existsSync(resolve(fixture.root,'second.bin')),false);
	} finally {fixture.close();}
});
