import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { candidateFixture } from '../../../support/development-candidate.ts';

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
