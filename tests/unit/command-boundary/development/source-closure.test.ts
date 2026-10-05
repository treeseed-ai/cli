import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { candidateFixture } from '../../../support/development-candidate.ts';
import { freezeCustody, repositoryClosure } from '../../../../src/cli/commands/development-support/candidate.ts';
import { developmentRuntimeSchema, type DevelopmentRuntime } from '@treeseed/sdk/development';
import { parse } from 'yaml';

const runtime = { project: { id: 'specimen', repository: 'example/specimen' } } as DevelopmentRuntime;

function freezeRecord(root:string) {
	return {session:{repositories:[{projectId:'specimen',worktree:root}],targets:[{projectId:'specimen',targetId:'package',mode:'candidate'}]},
		runtimes:[developmentRuntimeSchema.parse(parse(readFileSync(resolve(root,'treeseed.package.yaml'),'utf8')).development)]};
}

for(const kind of ['build','contract','missing','file','cycle'] as const) {
	test(`freeze command custody rejects ${kind} working directories before source capture`,()=>{
		const fixture=candidateFixture(),external=candidateFixture();
		try {
			const selected=freezeRecord(fixture.root),target=selected.runtimes[0]!.targets[0]!;
			if(kind==='build'||kind==='contract')symlinkSync(external.root,resolve(fixture.root,'working'));
			else if(kind==='file')writeFileSync(resolve(fixture.root,'working'),'not a directory');
			else if(kind==='cycle')symlinkSync('working',resolve(fixture.root,'working'));
			if(kind==='contract')target.freeze!.contractOperations=[{...target.freeze!.operation,cwd:'working'}];
			else target.freeze!.operation.cwd='working';
			assert.throws(()=>freezeCustody(selected),/working directory custody/);
			assert.equal(fixture.registrations.length,0);
		} finally {fixture.close();external.close();}
	});
}
test('freeze command custody preserves canonical contained directory aliases and default roots',()=>{
	const fixture=candidateFixture();
	try {
		const selected=freezeRecord(fixture.root);freezeCustody(selected).assert([]);
		mkdirSync(resolve(fixture.root,'working'));symlinkSync('working',resolve(fixture.root,'alias'));
		selected.runtimes[0]!.targets[0]!.freeze!.operation.cwd='alias';
		freezeCustody(selected).assert([]);
	} finally {fixture.close();}
});
test('freeze command custody rejects an ignored directory alias moving after capture',()=>{
	const fixture=candidateFixture(),external=candidateFixture();
	try {
		writeFileSync(resolve(fixture.root,'.gitignore'),'working\nverification.log\n');
		symlinkSync('scripts',resolve(fixture.root,'working'));
		const selected=freezeRecord(fixture.root);selected.runtimes[0]!.targets[0]!.freeze!.operation.cwd='working';
		const custody=freezeCustody(selected);unlinkSync(resolve(fixture.root,'working'));symlinkSync(external.root,resolve(fixture.root,'working'));
		assert.throws(()=>custody.assert([]),/working directory custody/);
		assert.equal(readFileSync(resolve(fixture.root,'scripts/verify.ts'),'utf8').includes('appendFileSync'),true);
	} finally {fixture.close();external.close();}
});

test('freeze custody binds exact source snapshots independently of command success',()=>{
	for(const kind of ['tracked','untracked','head','recipe','deleted'] as const) {
		const fixture=candidateFixture();
		try {
			const custody=freezeCustody(freezeRecord(fixture.root)); custody.assert([]);
			writeFileSync(resolve(fixture.root,'candidate.bin'),'generated'); custody.assert([]);
			if(kind==='head')fixture.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','moved');
			else if(kind==='deleted')rmSync(resolve(fixture.root,'scripts/verify.ts'));
			else writeFileSync(resolve(fixture.root,kind==='tracked'?'scripts/verify.ts':kind==='recipe'?'treeseed.package.yaml':'local-source.ts'),'changed');
			assert.throws(()=>custody.assert([]),/source changed during freeze: specimen/);
			assert.equal(fixture.registrations.length,0);
		} finally {fixture.close();}
	}
});

test('freeze custody rejects changed or missing captured artifacts while allowing uncaptured outputs',()=>{
	const fixture=candidateFixture();
	try {
		const custody=freezeCustody(freezeRecord(fixture.root)),path=resolve(fixture.root,'candidate.bin');
		writeFileSync(path,'sealed');
		const artifacts=[{projectId:'specimen',identity:'candidate.bin',digest:`sha256:${createHash('sha256').update('sealed').digest('hex')}`}];
		custody.assert(artifacts); writeFileSync(path,'changed'); custody.assert([]);
		assert.throws(()=>custody.assert(artifacts),/artifact changed during freeze/);
		rmSync(path); assert.throws(()=>custody.assert(artifacts),/artifact changed during freeze/);
	} finally {fixture.close();}
});

test('development closure excludes only declared artifact bytes while retaining source mutations',()=>{
	const fixture=candidateFixture();
	try {
		writeFileSync(resolve(fixture.root,'candidate.bin'),'before');
		const before=repositoryClosure(runtime,fixture.root,['candidate.bin']);
		writeFileSync(resolve(fixture.root,'candidate.bin'),'after');
		assert.deepEqual(repositoryClosure(runtime,fixture.root,['candidate.bin']),before);
		writeFileSync(resolve(fixture.root,'candidate.bin.ts'),'export {};');
		assert.notDeepEqual(repositoryClosure(runtime,fixture.root,['candidate.bin']),before);
	} finally {fixture.close();}
});

test('development closure detects moved HEAD with unchanged tracked source bytes',()=>{
	const fixture=candidateFixture();
	try {
		const before=repositoryClosure(runtime,fixture.root);
		fixture.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','moved');
		const after=repositoryClosure(runtime,fixture.root);
		assert.notEqual(after.commit,before.commit);
		assert.equal(after.dirtyDigest,before.dirtyDigest); assert.equal(after.dirty,false);
	} finally {fixture.close();}
});

test('development closure rejects a selected directory borrowing its parent Git root', () => {
	const fixture = candidateFixture();
	try {
		const nested=resolve(fixture.root,'nested'); mkdirSync(nested); writeFileSync(resolve(nested,'source.ts'),'export {};');
		assert.throws(()=>repositoryClosure(runtime,nested),/own exact Git source root/);
	} finally {fixture.close();}
});

test('development closure rejects Git loss even when the parent retains the same commit', () => {
	const fixture = candidateFixture();
	try {
		const nested=resolve(fixture.root,'nested'); mkdirSync(nested); cpSync(resolve(fixture.root,'.git'),resolve(nested,'.git'),{recursive:true});
		assert.equal(repositoryClosure(runtime,nested).commit,fixture.git('rev-parse','HEAD').trim());
		rmSync(resolve(nested,'.git'),{recursive:true});
		assert.throws(()=>repositoryClosure(runtime,nested),/own exact Git source root/);
	} finally {fixture.close();}
});

test('development closure accepts exact linked Git worktrees and canonical root aliases', () => {
	const fixture = candidateFixture();
	try {
		const linked=resolve(fixture.root,'linked'),alias=resolve(fixture.root,'alias');
		fixture.git('worktree','add','--detach',linked,'HEAD'); symlinkSync(linked,alias);
		assert.equal(repositoryClosure(runtime,linked).commit,fixture.git('rev-parse','HEAD').trim());
		assert.equal(repositoryClosure(runtime,alias).commit,repositoryClosure(runtime,linked).commit);
	} finally {fixture.close();}
});

test('development source digest binds same-size untracked binary bytes and newline paths', async () => {
	const fixture = candidateFixture();
	try {
		const file = resolve(fixture.root, 'source\nwith space.bin');
		writeFileSync(file, Buffer.from([0, 1, 2]));
		const before = await fixture.plan(), status = fixture.git('status', '--porcelain=v1');
		writeFileSync(file, Buffer.from([0, 2, 1]));
		const after = await fixture.plan();
		assert.equal(fixture.git('status', '--porcelain=v1'), status);
		assert.equal(before.commit, after.commit); assert.notEqual(before.dirtyDigest, after.dirtyDigest);
		assert.deepEqual(after, await fixture.plan()); assert.equal(fixture.registrations.length, 0);
	} finally { fixture.close(); }
});

test('development source digest binds untracked executable mode and symbolic link identity', async () => {
	const fixture = candidateFixture();
	try {
		const file = resolve(fixture.root, 'local-source.ts'), link = resolve(fixture.root, 'local-link');
		writeFileSync(file, 'export {};'); chmodSync(file, 0o644);
		const first = await fixture.plan(); chmodSync(file, 0o755);
		assert.notEqual((await fixture.plan()).dirtyDigest, first.dirtyDigest);
		symlinkSync('local-source.ts', link); const linked = await fixture.plan();
		rmSync(link); symlinkSync('treeseed.package.yaml', link);
		assert.notEqual((await fixture.plan()).dirtyDigest, linked.dirtyDigest);
	} finally { fixture.close(); }
});

test('development source digest retains tracked edits and ignores Git-excluded output', async () => {
	const fixture = candidateFixture();
	try {
		const clean = await fixture.plan(); assert.equal(clean.dirtyDigest, null);
		writeFileSync(resolve(fixture.root, 'ignored.bin'), 'ignored first'); assert.deepEqual(await fixture.plan(), clean);
		writeFileSync(resolve(fixture.root, '.gitignore'), 'verification.log\nignored.bin\n# changed\n');
		const tracked = await fixture.plan(); assert.notEqual(tracked.dirtyDigest, null);
		writeFileSync(resolve(fixture.root, 'ignored.bin'), 'ignored second'); assert.deepEqual(await fixture.plan(), tracked);
		mkdirSync(resolve(fixture.root, 'src')); writeFileSync(resolve(fixture.root, 'src/empty.ts'), '');
		assert.notEqual((await fixture.plan()).dirtyDigest, tracked.dirtyDigest);
	} finally { fixture.close(); }
});

test('development source planning rejects unreadable untracked bytes without manager effects', async () => {
	const fixture = candidateFixture();
	const file = resolve(fixture.root, 'unreadable.ts');
	try {
		writeFileSync(file, 'export {};'); chmodSync(file, 0);
		assert.equal(await fixture.tryPlan(), 1);
		assert.equal(fixture.registrations.length, 0);
		assert.match(fixture.output.join(''), /EACCES|permission denied/);
	} finally { chmodSync(file, 0o644); fixture.close(); }
});
