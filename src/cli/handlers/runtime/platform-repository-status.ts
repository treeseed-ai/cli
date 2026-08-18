import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { PlatformWorksetInventoryRepository } from '@treeseed/sdk';

function git(root: string, args: string[]) {
	return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

export type PlatformRepositoryStatus = {
	projectId: string;
	repository: string;
	path: string;
	state: 'missing' | 'ready' | 'dirty' | 'diverged' | 'detached' | 'invalid';
	branch: string | null;
	trackedUpstream: string | null;
	localHead: string | null;
	upstreamHead: string | null;
	ahead: number;
	behind: number;
	dirty: boolean;
	repair: string | null;
};

export function inspectPlatformRepository(root: string, entry: PlatformWorksetInventoryRepository): PlatformRepositoryStatus {
	const path = resolve(root, entry.path);
	const base = { projectId: entry.projectId, repository: entry.repository, path: entry.path };
	if (!existsSync(path)) return { ...base, state: 'missing', branch: null, trackedUpstream: null, localHead: null, upstreamHead: null, ahead: 0, behind: 0, dirty: false, repair: 'Materialize the governed workset with `trsd platform workset --apply --yes`.' };
	const top = git(path, ['rev-parse', '--show-toplevel']);
	if (top.status !== 0 || resolve(top.stdout.trim()) !== path) return { ...base, state: 'invalid', branch: null, trackedUpstream: null, localHead: null, upstreamHead: null, ahead: 0, behind: 0, dirty: false, repair: 'Move the conflicting path aside, then materialize the governed workset.' };
	const localHead = git(path, ['rev-parse', 'HEAD']).stdout.trim() || null;
	const branch = git(path, ['branch', '--show-current']).stdout.trim() || null;
	const trackedUpstream = git(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
	const upstream = trackedUpstream.status === 0 ? trackedUpstream.stdout.trim() || null : null;
	const upstreamHead = upstream ? git(path, ['rev-parse', upstream]).stdout.trim() || null : null;
	const dirty = Boolean(git(path, ['status', '--porcelain']).stdout.trim());
	let ahead = 0;
	let behind = 0;
	if (upstream) {
		const counts = git(path, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
		if (counts.status === 0) [ahead, behind] = counts.stdout.trim().split(/\s+/u).map((value) => Number.parseInt(value, 10) || 0);
	}
	const state = dirty ? 'dirty' : !branch ? 'detached' : ahead || behind ? 'diverged' : 'ready';
	const repair = dirty
		? 'Finish the active governed work or persist it with `trsd save`; automatic upstream convergence will not overwrite local changes.'
		: state === 'diverged'
			? 'Run `trsd update --strategy ff-only` after resolving any governed work custody.'
			: state === 'detached'
				? 'Detached exact-ref custody is expected only for a read-only or assignment-owned workset.'
				: null;
	return { ...base, state, branch, trackedUpstream: upstream, localHead, upstreamHead, ahead, behind, dirty, repair };
}

export function inspectPlatformRepositories(root: string, inventory: PlatformWorksetInventoryRepository[]) {
	return inventory.map((entry) => inspectPlatformRepository(root, entry));
}
