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

test('restore refuses a symlinked backup without removing the active overlay', () => {
	const f = fixture(); try {
		f.install(); const item = f.state.overlays[0]!; rmSync(item.backup!, { recursive: true }); symlinkSync(f.overlay, item.backup!);
		assert.throws(() => restoreOverlays(f.state, 'source', false), /backup is not a release directory/);
		assert.equal(resolve(item.link, '..', readlinkSync(item.link)), resolve(f.overlay, 'current'));
		assert.equal(existsSync(item.link), true);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});
