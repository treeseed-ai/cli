import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { candidateFixture } from '../../../support/development-candidate.ts';
import { freezeCustody, repositoryClosure } from '../../../../src/cli/commands/development-support/candidate.ts';
import { developmentCandidateSchema, developmentSessionSchema, developmentRuntimeSchema, type DevelopmentRuntime } from '@treeseed/sdk/development';
import { parse, stringify } from 'yaml';
import { runDevelopment } from '../../../../src/cli/commands/development.ts';
import { resolveCommand } from '../../../../src/cli/registry.ts';
import { parseInvocation } from '../../../../src/cli/parser.ts';

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

test('scoped provider freeze rejects every malformed unknown or duplicate root before executing or registering a candidate', async () => {
	const targets = [[], [''], [' '], ['specimen.unknown'], ['specimen.package', 'specimen.package'],
		['specimen.package=live'], ['specimen.*'], ['specimen.package.extra'], 'specimen.package', null, [3]];
	const outcomes = [];
	for (const target of targets) {
		const fixture = candidateFixture();
		try {
			assert.equal(await fixture.invoke(['dev', 'session', 'start', resolve(fixture.root, 'development.session.yaml')]), 0);
			const selected = resolveCommand(['dev', 'freeze']); assert.ok(selected);
			const invocation = parseInvocation(selected.command, ['--json']); Object.assign(invocation.options, { target });
			let message = ''; try { await runDevelopment(invocation, fixture.context); } catch (error) { message = String(error); }
			outcomes.push({ denied: /Development freeze target/u.test(message), registrations: fixture.registrations.length,
				built: existsSync(resolve(fixture.root, 'candidate.bin')) });
			assert.equal(readFileSync(resolve(fixture.root, 'scripts/freeze.ts'), 'utf8').includes('sealed'), true);
		} finally { fixture.close(); }
	}
	assert.deepEqual(outcomes, targets.map(() => ({ denied: true, registrations: 0, built: false })));
});

function assertNoCandidate(fixture:ReturnType<typeof candidateFixture>) {
	assert.equal(fixture.registrations.length,0);
	const files=(root:string):string[]=>readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(resolve(root,entry.name)):[entry.name]);
	assert.equal(files(fixture.state).some(name=>name.startsWith('candidate-')||name==='freeze.lock'),false);
}

test('native scoped provider freeze seals every declared dependency before its consumer while leaving unrelated dirty owners and commands untouched', async () => {
	const fixture = candidateFixture(), dependency = candidateFixture(), unrelated = candidateFixture();
	try {
		for (const [input, id] of [[dependency, 'dependency'], [unrelated, 'unrelated']] as const) {
			const path = resolve(input.root, 'treeseed.package.yaml');
			const runtime = developmentRuntimeSchema.parse(parse(readFileSync(path, 'utf8')).development);
			runtime.project.id = id; writeFileSync(path, stringify({ schemaVersion: 'treeseed.package/v1', development: runtime }));
		}
		const path = resolve(fixture.root, 'treeseed.package.yaml');
		const runtime = developmentRuntimeSchema.parse(parse(readFileSync(path, 'utf8')).development);
		runtime.targets[0]!.dependencies = [{ id: 'dependency', target: 'package', locality: 'local', reaction: 'rebuild' }];
		writeFileSync(path, stringify({ schemaVersion: 'treeseed.package/v1', development: runtime }));
		writeFileSync(resolve(fixture.root, 'scripts/freeze.ts'), `import {readFileSync,writeFileSync} from 'node:fs';if(readFileSync(${JSON.stringify(resolve(dependency.root, 'candidate.bin'))},'utf8')!=='sealed')throw Error('owning dependency was not frozen first');writeFileSync('candidate.bin','sealed consumer');\n`);
		writeFileSync(resolve(fixture.root, 'development.session.yaml'), stringify({ projects: [fixture, dependency, unrelated].map(input => ({
			manifest: resolve(input.root, 'treeseed.package.yaml'), worktree: input.root, targets: [{ id: 'package', mode: 'candidate' }],
		})) }));
		for (const input of [fixture, dependency, unrelated]) {
			input.git('add', '.'); input.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'scoped inputs');
		}
		writeFileSync(resolve(unrelated.root, 'unrelated-source.ts'), 'unrelated dirty bytes retained\n');
		const unrelatedHead = unrelated.git('rev-parse', 'HEAD'), unrelatedBytes = readFileSync(resolve(unrelated.root, 'unrelated-source.ts'));
		assert.equal(await fixture.invoke(['dev', 'session', 'start', resolve(fixture.root, 'development.session.yaml')]), 0);
		assert.equal(await fixture.invoke(['dev', 'freeze', '--target', 'specimen.package']), 0, fixture.output.join(''));
		const frozen = JSON.parse(fixture.output[0]!).result, candidate = developmentCandidateSchema.parse(frozen.candidate);
		assert.deepEqual(candidate.source.map(owner => owner.projectId).sort(), ['dependency', 'specimen']);
		assert.deepEqual(candidate.artifacts.map(artifact => `${artifact.projectId}.${artifact.targetId}`), ['dependency.package', 'specimen.package']);
		assert.deepEqual(Object.keys(candidate.dependencyGenerations).sort(), ['dependency.package', 'specimen.package']);
		assert.equal(candidate.source.some(owner => owner.dirty), false); assert.equal(candidate.verification.status, 'pending');
		assert.equal(existsSync(resolve(unrelated.root, 'candidate.bin')), false); assert.equal(fixture.registrations.length, 1);
		assert.equal(await fixture.verify(), 0, fixture.output.join(''));
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status, 'passed'); assert.equal(fixture.readReceipt(frozen.receipt).promotable, true);
		const receipt = readFileSync(frozen.receipt), source = readFileSync(resolve(dependency.root, 'scripts/verify.ts'));
		writeFileSync(resolve(dependency.root, 'scripts/verify.ts'), 'changed required dependency\n');
		assert.equal(await fixture.verify(), 1); assert.match(fixture.output.join(''), /Candidate source changed after freeze/);
		assert.deepEqual(readFileSync(frozen.receipt), receipt); assert.equal(fixture.registrations.length, 2);
		assert.equal(readFileSync(resolve(dependency.root, 'scripts/verify.ts'), 'utf8'), 'changed required dependency\n');
		writeFileSync(resolve(dependency.root, 'scripts/verify.ts'), source);
		assert.deepEqual(readFileSync(resolve(unrelated.root, 'unrelated-source.ts')), unrelatedBytes); assert.equal(unrelated.git('rev-parse', 'HEAD'), unrelatedHead);
		assert.equal(existsSync(resolve(unrelated.root, 'verification.log')), false);
	} finally { fixture.close(); dependency.close(); unrelated.close(); }
});

test('native scoped provider freeze refuses a missing declared dependency before any owning build or candidate', async () => {
	const fixture = candidateFixture();
	try {
		const path = resolve(fixture.root, 'treeseed.package.yaml');
		const runtime = developmentRuntimeSchema.parse(parse(readFileSync(path, 'utf8')).development);
		runtime.targets[0]!.dependencies = [{ id: 'absent', target: 'package', locality: 'local', reaction: 'rebuild' }];
		writeFileSync(path, stringify({ schemaVersion: 'treeseed.package/v1', development: runtime }));
		fixture.git('add', '.'); fixture.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'missing dependency input');
		assert.equal(await fixture.invoke(['dev', 'session', 'start', resolve(fixture.root, 'development.session.yaml')]), 0);
		assert.equal(await fixture.invoke(['dev', 'freeze', '--target', 'specimen.package']), 1);
		assert.match(fixture.output.join(''), /Development freeze dependency/); assertNoCandidate(fixture);
		assert.equal(existsSync(resolve(fixture.root, 'candidate.bin')), false);
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
