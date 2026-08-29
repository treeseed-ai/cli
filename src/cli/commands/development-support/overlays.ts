import { spawn } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DevelopmentRuntime, DevelopmentTarget } from '@treeseed/sdk/development';
import { developmentStateRoot } from '../development-cli-selection.js';

interface OverlaySessionState {
 sessionId: string;
 processes: Record<string, { pid: number; projectId: string; targetId: string; log: string }>;
 overlays: Array<{ projectId: string; packageName: string; link: string; backup: string | null; overlayRoot: string }>;
}

export async function stopProcesses(state: OverlaySessionState) {
	const running = Object.values(state.processes);
	for (const processState of running) {
		try { process.kill(-processState.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
	}
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline && running.some((processState) => { try { process.kill(processState.pid, 0); return true; } catch { return false; } })) await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	for (const processState of running) { try { process.kill(-processState.pid, 'SIGKILL'); } catch { /* process exited during the grace period */ } }
	state.processes = {};
	return running;
}

export function restoreOverlays(state: OverlaySessionState, projectId?: string, removeGenerations = true) {
	const retained: OverlaySessionState['overlays'] = [];
	for (const overlay of state.overlays ?? []) {
		if (projectId && overlay.projectId !== projectId) { retained.push(overlay); continue; }
		if (existsSync(overlay.link) || (() => { try { lstatSync(overlay.link); return true; } catch { return false; } })()) rmSync(overlay.link, { recursive: true, force: true });
		if (overlay.backup && existsSync(overlay.backup)) renameSync(overlay.backup, overlay.link);
	}
	if (removeGenerations) for (const overlayRoot of new Set((state.overlays ?? []).filter((overlay) => !projectId || overlay.projectId === projectId).map((overlay) => overlay.overlayRoot))) {
		rmSync(overlayRoot, { recursive: true, force: true }); rmSync(dirname(overlayRoot), { recursive: true, force: true });
	}
	state.overlays = retained;
}

function affectedConsumers(runtimes: DevelopmentRuntime[], projectId: string, targetId: string) {
	const affected = new Set([`${projectId}.${targetId}`]), queue = [...affected];
	while (queue.length) {
		const selected = queue.shift()!;
		for (const runtime of runtimes) for (const target of runtime.targets) for (const dependency of target.dependencies) {
			if (`${dependency.id}.${dependency.target}` !== selected || dependency.reaction === 'none') continue;
			const key = `${runtime.project.id}.${target.id}`; if (!affected.has(key)) { affected.add(key); queue.push(key); }
		}
	}
	return new Set([...affected].slice(1).map((key) => key.split('.')[0]!));
}

export function installPackageOverlay(state: OverlaySessionState, record: { session: { repositories: Array<{ projectId: string; worktree: string }> }; runtimes: DevelopmentRuntime[] }, runtime: DevelopmentRuntime, target: DevelopmentTarget, worktree: string, overlayRoot: string) {
	if (target.kind !== 'package-watch') return;
	const packageName = (JSON.parse(readFileSync(resolve(worktree, 'package.json'), 'utf8')) as { name?: string }).name;
	if (!packageName) throw new Error(`${runtime.project.id} package overlay has no package name.`);
	restoreOverlays(state, runtime.project.id, false);
	for (const consumerId of affectedConsumers(record.runtimes, runtime.project.id, target.id)) {
		const consumer = record.session.repositories.find((entry) => entry.projectId === consumerId); if (!consumer) continue;
		const link = resolve(consumer.worktree, 'node_modules', ...packageName.split('/'));
		const backup = `${link}.treeseed-release-${state.sessionId}`;
		mkdirSync(dirname(link), { recursive: true });
		if (existsSync(backup)) throw new Error(`Stale development overlay backup blocks ${link}.`);
		let retained: string | null = null;
		try { lstatSync(link); renameSync(link, backup); retained = backup; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		symlinkSync(relativeOverlayTarget(link, overlayRoot), link, 'dir'); state.overlays.push({ projectId: runtime.project.id, packageName, link, backup: retained, overlayRoot });
	}
}

export function relativeOverlayTarget(link: string, overlayRoot: string) {
	return relative(dirname(link), resolve(overlayRoot, 'current'));
}

export function startPackageSynchronizer(state: OverlaySessionState, runtime: DevelopmentRuntime, target: DevelopmentTarget, worktree: string, env: NodeJS.ProcessEnv) {
	const key = `overlay-sync.${runtime.project.id}.${target.id}`, overlayRoot = resolve(worktree, '.treeseed', 'cache', 'development-sessions', state.sessionId, target.id);
	const existing = state.processes[key]; if (existing) { try { process.kill(existing.pid, 0); return overlayRoot; } catch { delete state.processes[key]; } }
	const compiledModule = fileURLToPath(new URL('../development/package-overlay-sync.js', import.meta.url));
	const sourceModule = fileURLToPath(new URL('../development/package-overlay-sync.ts', import.meta.url));
	const module = existsSync(compiledModule) ? compiledModule : sourceModule, moduleArguments = existsSync(compiledModule) ? [module] : ['--import', 'tsx', module];
	const log = resolve(developmentStateRoot(env), state.sessionId, `${key}.log`);
	mkdirSync(dirname(log), { recursive: true, mode: 0o700 }); const descriptor = openSync(log, 'a', 0o600);
	try {
		if (target.ready.kind !== 'marker') throw new Error(`${key} requires marker readiness.`);
		const child = spawn(process.execPath, [...moduleArguments, worktree, overlayRoot, JSON.stringify(target.outputs.map((output) => output.path)), target.ready.path], { cwd: worktree, env, detached: true, stdio: ['ignore', descriptor, descriptor] });
		child.unref(); if (!child.pid) throw new Error(`Failed to start ${key}.`); state.processes[key] = { pid: child.pid, projectId: runtime.project.id, targetId: target.id, log };
	} finally { closeSync(descriptor); }
	return overlayRoot;
}

export async function waitForPackageOverlay(target: DevelopmentTarget, worktree: string, overlayRoot: string) {
	const timeout = target.ready.kind === 'marker' ? target.ready.timeoutSeconds : 120, deadline = Date.now() + timeout * 1_000;
	while (Date.now() < deadline) {
		const markerReady = target.ready.kind !== 'marker' || existsSync(resolve(worktree, target.ready.path));
		if (markerReady && existsSync(resolve(overlayRoot, 'current'))) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Completed package generation timed out for ${target.id}.`);
}

function overlayGeneration(overlayRoot: string) {
	const current = resolve(overlayRoot, 'current');
	try { return resolve(dirname(current), readlinkSync(current)); } catch { return null; }
}

export async function waitForNewPackageOverlay(target: DevelopmentTarget, worktree: string, overlayRoot: string, previous: string | null) {
	const timeout = target.ready.kind === 'marker' ? target.ready.timeoutSeconds : 120, deadline = Date.now() + timeout * 1_000;
	while (Date.now() < deadline) {
		const current = overlayGeneration(overlayRoot);
		const markerReady = target.ready.kind !== 'marker' || existsSync(resolve(worktree, target.ready.path));
		if (markerReady && current && current !== previous) return current;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`A new completed package generation timed out for ${target.id}; the previous generation remains selected.`);
}

export async function stopProcess(state: OverlaySessionState, key: string) {
	const processState = state.processes[key];
	if (!processState) return;
	try { process.kill(-processState.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try { process.kill(processState.pid, 0); } catch { break; }
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	}
	try { process.kill(-processState.pid, 'SIGKILL'); } catch { /* it exited during the grace period */ }
	delete state.processes[key];
}

export function dependentReactions(runtimes: DevelopmentRuntime[], projectId: string, targetId: string) {
	const result: Array<{ runtime: DevelopmentRuntime; target: DevelopmentTarget; reaction: string }> = [], queued = [`${projectId}.${targetId}`], seen = new Set(queued);
	while (queued.length) {
		const selected = queued.shift()!;
		for (const runtime of runtimes) for (const target of runtime.targets) for (const dependency of target.dependencies) {
			if (`${dependency.id}.${dependency.target}` !== selected || dependency.reaction === 'none') continue;
			const key = `${runtime.project.id}.${target.id}`;
			if (seen.has(key)) continue;
			seen.add(key); queued.push(key); result.push({ runtime, target, reaction: dependency.reaction });
		}
	}
	return result;
}

