import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { candidateFixture } from '../support/development-candidate.ts';
import { developmentSessionSchema } from '@treeseed/sdk/development';

function declareSecondArtifact(root: string, separateTarget=false) {
	const manifest=resolve(root,'treeseed.package.yaml');
	const document=parse(readFileSync(manifest,'utf8')) as {development:{targets:Array<{id:string;freeze:{artifacts:string[]}}>}};
	const target=document.development.targets[0]!;
	if(separateTarget) {
		document.development.targets.push({...target,id:'second',freeze:{...target.freeze,artifacts:['second.bin']}});
		const session=resolve(root,'development.session.yaml');
		writeFileSync(session,readFileSync(session,'utf8').replace('targets: [{ id: package, mode: candidate }]','targets: [{ id: package, mode: candidate }, { id: second, mode: candidate }]'));
	}
	else target.freeze.artifacts.push('second.bin');
	writeFileSync(manifest,stringify(document));
	writeFileSync(resolve(root,'scripts/freeze.ts'),"import { writeFileSync } from 'node:fs'; writeFileSync('candidate.bin','sealed'); writeFileSync('second.bin','sealed second');\n");
}

test('native candidate verification executes each owned target once while checking all its artifacts', async () => {
	const fixture=candidateFixture();
	try {
		declareSecondArtifact(fixture.root); const frozen=await fixture.freeze();
		assert.equal(await fixture.verify(),0,fixture.output.join(''));
		assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'verified\n');
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status,'passed');
		assert.equal(fixture.registrations.length,2);
		writeFileSync(resolve(fixture.root,'second.bin'),'changed');
		assert.equal(await fixture.verify(),1); assert.equal(fixture.registrations.length,2);
		assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'verified\n');
	} finally {fixture.close();}
});

test('native candidate verification rejects changed tracked source before executing any verifier', async () => {
	const fixture=candidateFixture();
	try {
		const frozen=await fixture.freeze(),receipt=readFileSync(frozen.receipt,'utf8');
		writeFileSync(resolve(fixture.root,'scripts/verify.ts'),"import { writeFileSync } from 'node:fs'; writeFileSync('verification.log','UNREVIEWED');\n");
		assert.equal(await fixture.verify(),1);
		assert.equal(existsSync(resolve(fixture.root,'verification.log')),false);
		assert.match(fixture.output.join(''),/Candidate source changed after freeze/);
		assert.equal(fixture.registrations.length,1); assert.equal(readFileSync(frozen.receipt,'utf8'),receipt);
	} finally {fixture.close();}
});

test('native candidate verification rejects a later artifact without an owned verifier before any side effect', async () => {
	const fixture=candidateFixture();
	try {
		const frozen=await fixture.freeze(),candidate=JSON.parse(readFileSync(frozen.receipt,'utf8'));
		candidate.artifacts.push({...candidate.artifacts[0],targetId:'unknown-target'});
		writeFileSync(frozen.receipt,JSON.stringify(candidate)); const receipt=readFileSync(frozen.receipt,'utf8');
		assert.equal(await fixture.verify(),1);
		assert.equal(existsSync(resolve(fixture.root,'verification.log')),false);
		assert.match(fixture.output.join(''),/verification operation is unavailable/);
		assert.equal(fixture.registrations.length,1); assert.equal(readFileSync(frozen.receipt,'utf8'),receipt);
	} finally {fixture.close();}
});

test('native candidate verification checks every artifact before the first verifier executes', async () => {
	const fixture=candidateFixture();
	try {
		const frozen=await fixture.freeze(),candidate=JSON.parse(readFileSync(frozen.receipt,'utf8'));
		candidate.artifacts.push({...candidate.artifacts[0],identity:'absent.bin'});
		writeFileSync(frozen.receipt,JSON.stringify(candidate)); const receipt=readFileSync(frozen.receipt,'utf8');
		assert.equal(await fixture.verify(),1);
		assert.equal(existsSync(resolve(fixture.root,'verification.log')),false);
		assert.match(fixture.output.join(''),/artifact custody failed/);
		assert.equal(fixture.registrations.length,1); assert.equal(readFileSync(frozen.receipt,'utf8'),receipt);
	} finally {fixture.close();}
});

test('native candidate verification blocks later verifiers after source mutation in the first operation', async () => {
	const fixture=candidateFixture();
	try {
		declareSecondArtifact(fixture.root,true);
		writeFileSync(resolve(fixture.root,'scripts/verify.ts'),"import { appendFileSync,writeFileSync } from 'node:fs'; appendFileSync('verification.log','verified\\n'); writeFileSync('mutated-source.ts','changed');\n");
		const frozen=await fixture.freeze();
		const receipt=readFileSync(frozen.receipt,'utf8');
		assert.equal(await fixture.verify(),1);
		assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'verified\n');
		assert.match(fixture.output.join(''),/Candidate source changed after freeze/);
		assert.equal(fixture.registrations.length,1); assert.equal(readFileSync(frozen.receipt,'utf8'),receipt);
	} finally {fixture.close();}
});

test('native candidate verification blocks later verifiers after an earlier artifact changes', async () => {
	const fixture=candidateFixture();
	try {
		declareSecondArtifact(fixture.root,true);
		writeFileSync(resolve(fixture.root,'scripts/verify.ts'),"import { appendFileSync,writeFileSync } from 'node:fs'; appendFileSync('verification.log','verified\\n'); writeFileSync('candidate.bin','changed');\n");
		await fixture.freeze();
		assert.equal(await fixture.verify(),1);
		assert.equal(readFileSync(resolve(fixture.root,'verification.log'),'utf8'),'verified\n');
		assert.equal(fixture.registrations.length,1);
	} finally {fixture.close();}
});

for (const kind of ['bytes', 'mode', 'link', 'deleted', 'added', 'during verification'] as const) {
	test(`native candidate verification rejects untracked ${kind} changes without registering a pass`, async () => {
		const fixture = candidateFixture();
		try {
			const source = resolve(fixture.root, 'local-source.ts');
			if (kind === 'link') symlinkSync('treeseed.package.yaml', source);
			else { writeFileSync(source, 'export const a = 1;'); chmodSync(source, 0o644); }
			if (kind === 'during verification') writeFileSync(resolve(fixture.root, 'scripts/verify.ts'), "import { appendFileSync, writeFileSync } from 'node:fs'; appendFileSync('verification.log', 'verified\\n'); writeFileSync('local-source.ts', 'export const a = 2;');\n");
			const frozen = await fixture.freeze(), receipt = readFileSync(frozen.receipt, 'utf8');
			if (kind === 'bytes') writeFileSync(source, 'export const a = 2;');
			else if (kind === 'mode') chmodSync(source, 0o755);
			else if (kind === 'link') { rmSync(source); symlinkSync('.gitignore', source); }
			else if (kind === 'deleted') rmSync(source);
			else if (kind === 'added') writeFileSync(resolve(fixture.root, 'additional.ts'), '');
			assert.equal(await fixture.verify(), 1, `Changed ${kind} was incorrectly verified`);
			assert.match(fixture.output.join(''), /Candidate source changed after freeze/);
			assert.equal(fixture.registrations.length, 1);
			assert.equal(readFileSync(frozen.receipt, 'utf8'), receipt);
			if(kind==='during verification') assert.equal(readFileSync(resolve(fixture.root, 'verification.log'), 'utf8'), 'verified\n');
			else assert.equal(existsSync(resolve(fixture.root,'verification.log')),false);
		} finally { fixture.close(); }
	});
}

test('native dirty candidate verification excludes generated artifact and remains non-promotable', async () => {
	const fixture = candidateFixture();
	try {
		writeFileSync(resolve(fixture.root, 'local-source.ts'), 'export {};');
		const frozen = await fixture.freeze();
		assert.equal(await fixture.verify(), 0, fixture.output.join(''));
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status, 'passed');
		assert.equal(fixture.readReceipt(frozen.receipt).promotable, false);
		assert.equal(fixture.registrations.length, 2);
		assert.equal(await fixture.verify(), 0, fixture.output.join(''));
		writeFileSync(resolve(fixture.root, 'candidate.bin'), 'tampered');
		assert.equal(await fixture.verify(), 1);
		assert.match(fixture.output.join(''), /artifact custody failed/);
		assert.equal(fixture.registrations.length, 3);
	} finally { fixture.close(); }
});

test('native provider candidate verification denies a moved dependency generation before another command without replacing its sealed receipt', async () => {
	const fixture = candidateFixture();
	try {
		const frozen = await fixture.freeze(), receipt = readFileSync(frozen.receipt), invoke = fixture.context.hostInvoke!;
		fixture.context.hostInvoke = async input => {
			const value = await invoke(input);
			if (input.handlerId !== 'local.dev.status') return value;
			assert.ok(value && typeof value === 'object' && !Array.isArray(value));
			const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
			const session = developmentSessionSchema.parse(record.session);
			session.targets[0]!.generation += 1;
			return { ...record, session };
		};
		assert.equal(await fixture.verify(), 1); assert.match(fixture.output.join(''), /Candidate dependency generation/);
		assert.equal(existsSync(resolve(fixture.root, 'verification.log')), false);
		assert.equal(fixture.registrations.length, 1); assert.deepEqual(readFileSync(frozen.receipt), receipt);
	} finally { fixture.close(); }
});
