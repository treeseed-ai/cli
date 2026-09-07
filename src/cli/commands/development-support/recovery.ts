import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import type { DevelopmentRuntime } from '@treeseed/sdk/development';
import { parse } from 'yaml';
import { developmentStateRoot } from '../development-cli-selection.js';

type Process = { pid: number; processGroup: number; cwd: string; argv: string[]; sessionId?: string; worktree?: string };
type Record = { session: { sessionId: string; status: string; repositories: Array<{ projectId: string; worktree: string }>; targets: Array<{ projectId: string; targetId: string; mode: string }> }; runtimes: DevelopmentRuntime[] };
type State = { sessionId: string; manifest: string; workspaceRoot: string; processes: globalThis.Record<string, { pid: number; projectId: string; targetId: string; log: string }>; overlays: Array<{ projectId: string; packageName: string; link: string; backup: string | null; overlayRoot: string }>; candidates: string[] };

export function findDevelopmentWorkspaceRoot(worktree: string): string | null {
	let root = worktree;
	while (!existsSync(resolve(root, 'treeseed.site.yaml'))) {
		const parent = dirname(root);
		if (parent === root) return null;
		root = parent;
	}
	return realpathSync(root);
}

/** Read only same-user process identity markers; never return arbitrary environment values. */
export function developmentProcesses(): Process[] {
	if (process.platform !== 'linux') throw new Error('Development custody recovery currently requires Linux process ownership evidence.');
	return readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
		try {
			const root = `/proc/${name}`;
			if (statSync(root).uid !== process.getuid!()) return [];
			const values = readFileSync(`${root}/environ`, 'utf8').split('\0');
			const marker = (key: string) => values.find(value => value.startsWith(`${key}=`))?.slice(key.length + 1);
			const stat = readFileSync(`${root}/stat`, 'utf8');
			const processGroup = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
			return [{ pid: Number(name), processGroup, cwd: readlinkSync(`${root}/cwd`), argv: readFileSync(`${root}/cmdline`, 'utf8').split('\0').filter(Boolean),
				sessionId: marker('TREESEED_DEVELOPMENT_SESSION_ID'), worktree: marker('TREESEED_DEVELOPMENT_WORKTREE') }];
		} catch { return []; } // Unreadable or exited processes are not custody evidence.
	});
}

export function matchDevelopmentProcess(candidates: Process[], expected: { sessionId: string; worktree: string; cwd: string; command: string; args: string[] }) {
	const matches = candidates.filter(candidate => candidate.processGroup === candidate.pid && candidate.sessionId === expected.sessionId && candidate.worktree === expected.worktree
		&& candidate.cwd === expected.cwd && basename(candidate.argv[0] ?? '') === expected.command
		&& JSON.stringify(candidate.argv.slice(1)) === JSON.stringify(expected.args));
	if (matches.length > 1) throw new Error('Ambiguous development process ownership; no session state was changed.');
	return matches[0];
}

export function planDevelopmentRecovery(record: Record, env: NodeJS.ProcessEnv, candidates: Process[] = developmentProcesses(), otherSessions: Record[] = []) {
	const { session } = record;
	if (!/^dev-[a-z0-9-]{1,64}$/.test(session.sessionId)) throw new Error('An exact manager session is required for recovery.');
	const expired = ['stopped', 'expired'].includes(session.status);
	const root = resolve(developmentStateRoot(env), session.sessionId);
	let common = session.repositories[0]?.worktree;
	if (!common) throw new Error('Recovery requires repository custody.');
	while (!session.repositories.every(repository => repository.worktree === common || repository.worktree.startsWith(`${common}${sep}`))) common = dirname(common);
	const workspaceRoot = findDevelopmentWorkspaceRoot(common);
	if (!workspaceRoot) throw new Error('Recovery requires one unambiguous Platform workspace.');
	const state: State = { sessionId: session.sessionId, manifest: resolve(root, 'recovered-manifest.json'), workspaceRoot, processes: {}, overlays: [], candidates: [] };
	const projects: Array<{ manifest: string; worktree: string }> = [];
	for (const repository of session.repositories) {
		const worktree = realpathSync(repository.worktree);
		if (worktree !== repository.worktree) throw new Error('Recovery refuses a symlinked worktree.');
		const runtime = record.runtimes.find(entry => entry.project.id === repository.projectId);
		if (!runtime) throw new Error('Manager runtime inventory is incomplete.');
		const manifest = resolve(worktree, 'treeseed.package.yaml');
		if (!existsSync(manifest)) throw new Error('Recovery requires the registered package manifest.');
		if (realpathSync(manifest) !== manifest) throw new Error('Recovery refuses a symlinked manifest.');
		const current = parse(readFileSync(manifest, 'utf8'))?.development as DevelopmentRuntime | undefined;
		if (current?.project.id !== repository.projectId) throw new Error('Package manifest identity differs from manager custody.');
		projects.push({ manifest, worktree });
		for (const selected of session.targets.filter(target => target.projectId === repository.projectId && target.mode !== 'released')) {
			const target = runtime.targets.find(entry => entry.id === selected.targetId);
			if (!target) throw new Error('Manager target inventory is incomplete.');
			const currentTarget = current.targets.find(entry => entry.id === target.id);
			if (currentTarget?.kind !== target.kind || JSON.stringify(currentTarget.operations.start) !== JSON.stringify(target.operations.start)
				|| JSON.stringify(currentTarget.operations.watch) !== JSON.stringify(target.operations.watch)) throw new Error('Active development recipe changed; recovery requires reconciled runtime custody.');
			if (target.operations.start?.command === 'docker') continue; // The supervisor owns container custody.
			const operation = target.kind === 'package-watch' ? target.operations.watch ?? target.operations.build : target.operations.start;
			if (!operation) throw new Error('Active target has no recoverable process operation.');
			const found = matchDevelopmentProcess(candidates, { sessionId: session.sessionId, worktree, cwd: operation.cwd ? resolve(worktree, operation.cwd) : worktree, command: operation.command, args: operation.args });
			if (!found && expired) continue;
			if (!found) throw new Error(`No unique owned process for ${repository.projectId}.${target.id}; no state changed.`);
			const key = `${repository.projectId}.${target.id}`;
			state.processes[key] = { pid: found.pid, projectId: repository.projectId, targetId: target.id, log: resolve(root, `${key}.log`) };
			if (target.kind !== 'package-watch') continue;
			const overlayRoot = resolve(worktree, '.treeseed/cache/development-sessions', session.sessionId, target.id);
			const sync = candidates.filter(candidate => candidate.processGroup === candidate.pid && candidate.cwd === worktree && candidate.argv.some(value => /^package-overlay-sync\.(js|ts)$/.test(basename(value)))
				&& candidate.argv.includes(overlayRoot) && candidate.argv.includes(worktree));
			if (sync.length > 1) throw new Error('Ambiguous package synchronizer ownership.');
			if (sync[0]) state.processes[`overlay-sync.${key}`] = { pid: sync[0].pid, projectId: repository.projectId, targetId: target.id, log: resolve(root, `overlay-sync.${key}.log`) };
			const packageName = JSON.parse(readFileSync(resolve(worktree, 'package.json'), 'utf8')).name as string;
			if (!/^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/i.test(packageName)) throw new Error('Invalid package identity.');
			for (const consumer of session.repositories) {
				const link = resolve(consumer.worktree, 'node_modules', ...packageName.split('/'));
				const backup = `${link}.treeseed-release-${session.sessionId}`;
				let linked = false;
				try { linked = lstatSync(link).isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === resolve(overlayRoot, 'current'); } catch { /* No link is not evidence of ownership. */ }
				if (existsSync(backup) && !linked) {
					const foreign = otherSessions.some(other => other.session.sessionId !== session.sessionId
						&& !['stopped', 'expired'].includes(other.session.status)
						&& other.session.repositories.some(entry => entry.projectId === repository.projectId && entry.worktree === worktree)
						&& (() => { try { return lstatSync(link).isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === resolve(worktree, '.treeseed/cache/development-sessions', other.session.sessionId, target.id, 'current'); } catch { return false; } })());
					if (!foreign) throw new Error(`Overlay backup for ${consumer.projectId}/${repository.projectId} has no verified owner; recovery is ambiguous.`);
					continue; // Another registered session owns this link; preserve both its link and the prior backup.
				}
				if (linked) state.overlays.push({ projectId: repository.projectId, packageName, link, backup: existsSync(backup) ? backup : null, overlayRoot });
			}
		}
	}
	return { state, projects };
}

export function applyDevelopmentRecovery(plan: ReturnType<typeof planDevelopmentRecovery>) {
	const root = dirname(plan.state.manifest), snapshot = resolve(root, 'session.json');
	if (existsSync(snapshot)) throw new Error('Session custody already exists; use the existing session.');
	mkdirSync(root, { recursive: true, mode: 0o700 });
	writeFileSync(plan.state.manifest, `${JSON.stringify({ projects: plan.projects }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
	const value = `${JSON.stringify(plan.state, null, 2)}\n`;
	writeFileSync(`${snapshot}.new`, value, { mode: 0o600, flag: 'wx' }); renameSync(`${snapshot}.new`, snapshot);
	const current = resolve(dirname(root), 'current.json');
	if (existsSync(current) && JSON.parse(readFileSync(current, 'utf8')).sessionId === plan.state.sessionId) {
		writeFileSync(`${current}.new`, value, { mode: 0o600, flag: 'wx' }); renameSync(`${current}.new`, current);
	}
	// Preserve current.json when another session owns the selection.
}
