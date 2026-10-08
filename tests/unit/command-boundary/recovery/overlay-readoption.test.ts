import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, readlinkSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { installPackageOverlay, restoreOverlays } from '../../../../src/cli/commands/development-support/overlays.ts';

function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-overlay-')), source = resolve(root, 'source'), overlay = resolve(root, 'overlay');
	mkdirSync(source); mkdirSync(resolve(overlay, 'current'), { recursive: true }); writeFileSync(resolve(source, 'package.json'), '{"name":"@test/source"}');
	const runtime: any = { project: { id: 'source' }, targets: [] }, target: any = { id: 'package', kind: 'package-watch' };
	const consumers = ['one', 'two'].map(projectId => {
		const worktree = resolve(root, projectId); mkdirSync(resolve(worktree, 'node_modules/@test/source'), { recursive: true });
		writeFileSync(resolve(worktree, 'node_modules/@test/source/original'), projectId); return { projectId, worktree };
	});
	const record: any = { session: { repositories: consumers }, runtimes: consumers.map(item => ({ project: { id: item.projectId }, targets: [{ id: 'app', dependencies: [{ id: 'source', target: 'package', reaction: 'restart' }] }] })) };
	const state: any = { sessionId: 'dev-test', processes: {}, overlays: [] };
	const install = () => installPackageOverlay(state, record, runtime, target, source, overlay);
	return { root, state, consumers, install, overlay };
}

test('re-adopts exact links and preserves release originals without nesting backups', () => {
	const f = fixture(); try {
		f.install(); const links = f.state.overlays.map((item: any) => ({ ...item })); f.state.overlays = [];
		f.install(); assert.deepEqual(f.state.overlays, links); f.install(); assert.equal(f.state.overlays.length, 2);
		restoreOverlays(f.state, 'source', false);
		for (const item of f.consumers) assert.equal(readFileSync(resolve(item.worktree, 'node_modules/@test/source/original'), 'utf8'), item.projectId);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a later foreign backup conflict does not mutate any earlier consumer', () => {
	const f = fixture(); try {
		const second = resolve(f.consumers[1]!.worktree, 'node_modules/@test/source');
		symlinkSync(f.overlay, `${second}.treeseed-release-dev-test`);
		assert.throws(f.install, /backup is not a release directory/);
		assert.equal(f.state.overlays.length, 0);
		assert.ok(existsSync(resolve(f.consumers[0]!.worktree, 'node_modules/@test/source/original')));
		assert.equal(readlinkSync(`${second}.treeseed-release-dev-test`), f.overlay);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('foreign development links and symlinked backups are rejected before mutation', () => {
	const f = fixture(); try {
		const first = resolve(f.consumers[0]!.worktree, 'node_modules/@test/source');
		rmSync(first, { recursive: true }); symlinkSync(resolve(f.root, 'foreign/current'), first);
		assert.throws(f.install, /Another development overlay blocks/); assert.equal(f.state.overlays.length, 0);
		unlinkSync(first); mkdirSync(first); writeFileSync(resolve(first, 'original'), 'one');
		symlinkSync(f.overlay, `${first}.treeseed-release-dev-test`);
		assert.throws(f.install, /backup is not a release directory/); assert.equal(f.state.overlays.length, 0);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a recorded session overlay repairs a package-manager link without replacing its release backup', () => {
	const f = fixture(); try {
		f.install(); const item = f.state.overlays[0]!; const originalBackup = item.backup;
		rmSync(item.link, { recursive: true, force: true }); symlinkSync(resolve(f.root, 'package-manager/source'), item.link);
		f.install();
		assert.equal(resolve(item.link, '..', readlinkSync(item.link)), resolve(f.overlay, 'current'));
		assert.equal(f.state.overlays.length, 2);
		assert.equal(f.state.overlays[0]!.backup, originalBackup);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('restore refuses a symlinked backup without removing the active overlay', () => {
	const f = fixture(); try {
		f.install(); const item = f.state.overlays[0]!; rmSync(item.backup!, { recursive: true }); symlinkSync(f.overlay, item.backup!);
		assert.throws(() => restoreOverlays(f.state, 'source', false), /backup is not a release directory/);
		assert.equal(resolve(item.link, '..', readlinkSync(item.link)), resolve(f.overlay, 'current'));
		assert.equal(existsSync(item.link), true);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('duplicate overlay ownership conflicts deny restoration before changing recorded custody', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-overlay-conflict-'));
	try {
		const original = { projectId: 'source', packageName: '@test/source', link: resolve(root, 'link'),
			backup: resolve(root, 'release'), overlayRoot: resolve(root, 'overlay') };
		const conflicts = [
			{ projectId: 'foreign' }, { packageName: '@test/foreign' },
			{ backup: null }, { backup: resolve(root, 'foreign-release') },
			{ overlayRoot: resolve(root, 'foreign-overlay') },
		];
		const observations = conflicts.map(conflict => {
			const state = { sessionId: 'dev-test', processes: {}, overlays: [original, { ...original, ...conflict }] };
			const held = structuredClone(state);
			let failure: unknown;
			try { restoreOverlays(state, 'source', false); } catch (error) { failure = error; }
			return { state, held, failure };
		});
		for (const { state, held, failure } of observations) {
			assert.ok(failure instanceof Error && /Conflicting development overlay custody/u.test(failure.message));
			assert.deepEqual(state, held);
		}
	} finally { rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false); }
});

test('native duplicate overlay restoration preserves exact release bytes and unrelated ownership through replay', () => {
	const f = fixture();
	try {
		const releases = new Map(f.consumers.map(item => [item.worktree,
			readFileSync(resolve(item.worktree, 'node_modules/@test/source/original'))]));
		f.install();
		const owned: Parameters<typeof restoreOverlays>[0]['overlays'] = structuredClone(f.state.overlays);
		const retained = { projectId: 'unrelated', packageName: '@test/unrelated',
			link: resolve(f.root, 'unrelated/link'), backup: null, overlayRoot: resolve(f.root, 'unrelated/overlay') };
		mkdirSync(retained.link, { recursive: true }); writeFileSync(resolve(retained.link, 'held'), 'unrelated');
		const unrelated = readFileSync(resolve(retained.link, 'held'));
		f.state.overlays = [...owned, retained, ...structuredClone(owned), ...structuredClone(owned)];
		restoreOverlays(f.state, 'source', false);
		for (const item of f.consumers) {
			assert.deepEqual(readFileSync(resolve(item.worktree, 'node_modules/@test/source/original')), releases.get(item.worktree));
		}
		for (const item of owned) assert.equal(existsSync(item.backup!), false);
		assert.deepEqual(f.state.overlays, [retained]);
		assert.deepEqual(readFileSync(resolve(retained.link, 'held')), unrelated);
		restoreOverlays(f.state, 'source', false);
		for (const item of f.consumers) {
			assert.deepEqual(readFileSync(resolve(item.worktree, 'node_modules/@test/source/original')), releases.get(item.worktree));
		}
		assert.deepEqual(f.state.overlays, [retained]);
		assert.deepEqual(readFileSync(resolve(retained.link, 'held')), unrelated);
	} finally { rmSync(f.root, { recursive: true, force: true }); assert.equal(existsSync(f.root), false); }
});

test('re-adoption rejects contradictory recorded identity before changing any native consumer or custody', () => {
	const f = fixture();
	try {
		f.install();
		const owned: Parameters<typeof restoreOverlays>[0]['overlays'] = structuredClone(f.state.overlays);
		for (const conflict of [{ projectId: 'foreign' }, { packageName: '@test/foreign' },
			{ backup: resolve(f.root, 'foreign-release') }, { overlayRoot: resolve(f.root, 'foreign-overlay') }]) {
			f.state.overlays = [...structuredClone(owned), { ...owned[0]!, ...conflict }];
			const before = structuredClone(f.state), links = owned.map(item => readlinkSync(item.link));
			assert.throws(f.install, /Conflicting development overlay custody/u);
			assert.deepEqual(f.state, before);
			for (const [index, item] of owned.entries()) {
				assert.equal(readlinkSync(item.link), links[index]);
				assert.ok(existsSync(resolve(item.backup!, 'original')));
			}
		}
	} finally { rmSync(f.root, { recursive: true, force: true }); assert.equal(existsSync(f.root), false); }
});

test('native exact-link re-adoption reconciles an observed regular release backup once and preserves release bytes through restoration', () => {
	const f = fixture();
	try {
		f.install();
		const owned: Parameters<typeof restoreOverlays>[0]['overlays'] = structuredClone(f.state.overlays);
		const bytes = owned.map(item => readFileSync(resolve(item.backup!, 'original')));
		const first = owned[0]!, invalid = Buffer.from('not a release directory');
		rmSync(first.backup!, { recursive: true }); writeFileSync(first.backup!, invalid);
		const held = structuredClone(f.state), link = readlinkSync(first.link);
		assert.throws(f.install, /backup is not a release directory/u);
		assert.deepEqual(f.state, held); assert.equal(readlinkSync(first.link), link); assert.deepEqual(readFileSync(first.backup!), invalid);
		unlinkSync(first.backup!); mkdirSync(first.backup!); writeFileSync(resolve(first.backup!, 'original'), bytes[0]!);
		const retained = { projectId: 'unrelated', packageName: '@test/unrelated', link: resolve(f.root, 'retained'),
			backup: null, overlayRoot: resolve(f.root, 'retained-overlay') };
		f.state.overlays = [{ ...owned[0]!, backup: null }, ...owned, retained, ...structuredClone(owned)];
		f.install(); assert.deepEqual(f.state.overlays, [...owned, retained]);
		f.install(); assert.deepEqual(f.state.overlays, [...owned, retained]);
		for (const [index, item] of owned.entries()) assert.deepEqual(readFileSync(resolve(item.backup!, 'original')), bytes[index]);
		restoreOverlays(f.state, 'source', false);
		assert.deepEqual(f.state.overlays, [retained]);
		for (const [index, item] of owned.entries()) {
			assert.deepEqual(readFileSync(resolve(item.link, 'original')), bytes[index]); assert.equal(existsSync(item.backup!), false);
		}
	} finally { rmSync(f.root, { recursive: true, force: true }); assert.equal(existsSync(f.root), false); }
});

test('selected overlay restoration leaves unrelated contradictory custody unmodified while full restoration still denies', () => {
	const unrelated = { projectId: 'unrelated', packageName: '@test/unrelated', link: '/unused/unrelated-link',
		backup: null, overlayRoot: '/unused/unrelated-overlay' };
	const state: Parameters<typeof restoreOverlays>[0] = { sessionId: 'dev-test', processes: {},
		overlays: [unrelated, { ...unrelated, backup: '/unused/unrelated-release' }] };
	const held = structuredClone(state);
	assert.doesNotThrow(() => restoreOverlays(state, 'source', false));
	assert.deepEqual(state, held);
	assert.throws(() => restoreOverlays(state, undefined, false), /Conflicting development overlay custody/u);
	assert.deepEqual(state, held);
});

test('native selected overlay restoration preserves foreign duplicate links backups and records through exact replay', () => {
	const f = fixture();
	try {
		f.install();
		const owned: Parameters<typeof restoreOverlays>[0]['overlays'] = structuredClone(f.state.overlays);
		const releases = owned.map(item => readFileSync(resolve(item.backup!, 'original')));
		const link = resolve(f.root, 'unrelated-link'), backup = resolve(f.root, 'unrelated-release');
		mkdirSync(backup); const bytes = Buffer.from('retained unrelated release\n');
		writeFileSync(resolve(backup, 'original'), bytes); symlinkSync(f.overlay, link);
		const retained = [{ projectId: 'unrelated', packageName: '@test/unrelated', link, backup: null,
			overlayRoot: f.overlay }, { projectId: 'unrelated', packageName: '@test/unrelated', link, backup,
			overlayRoot: f.overlay }];
		f.state.overlays = [...owned, ...retained];
		for (let replay = 0; replay < 2; replay++) {
			restoreOverlays(f.state, 'source', false);
			assert.deepEqual(f.state.overlays, retained);
			for (const [index, item] of owned.entries()) {
				assert.deepEqual(readFileSync(resolve(item.link, 'original')), releases[index]);
				assert.equal(existsSync(item.backup!), false);
			}
			assert.equal(readlinkSync(link), f.overlay);
			assert.deepEqual(readFileSync(resolve(backup, 'original')), bytes);
		}
		const held = structuredClone(f.state);
		assert.throws(() => restoreOverlays(f.state, undefined, false), /Conflicting development overlay custody/u);
		assert.deepEqual(f.state, held); assert.equal(readlinkSync(link), f.overlay);
		assert.deepEqual(readFileSync(resolve(backup, 'original')), bytes);
	} finally { rmSync(f.root, { recursive: true, force: true }); assert.equal(existsSync(f.root), false); }
});
