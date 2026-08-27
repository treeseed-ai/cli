import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentCandidateSchema, developmentRuntimeSchema, type DevelopmentRuntime, type DevelopmentTarget } from '@treeseed/sdk/development';
import { parse as parseYaml } from 'yaml';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { invokeLocalHostManager } from '../support/host-client.js';

interface LocalSessionState {
	sessionId: string;
	manifest: string;
	processes: Record<string, { pid: number; projectId: string; targetId: string; log: string }>;
	overlays: Array<{ projectId: string; packageName: string; link: string; backup: string | null; overlayRoot: string }>;
	candidates: string[];
}

interface ProjectSelection { manifest: string; worktree?: string; targets?: Array<{ id: string; mode: 'released' | 'candidate' | 'live' }> }

function developmentStateRoot(env: NodeJS.ProcessEnv) {
	const base = env.XDG_STATE_HOME ?? (env.HOME ? resolve(env.HOME, '.local', 'state') : null);
	if (!base) throw new Error('HOME or XDG_STATE_HOME is required for development-session custody.');
	return resolve(base, 'treeseed', 'development');
}

function statePath(env: NodeJS.ProcessEnv) { return resolve(developmentStateRoot(env), 'current.json'); }

function saveState(state: LocalSessionState, env: NodeJS.ProcessEnv) {
	const path = statePath(env), temporary = `${path}.new`;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, path);
}

function loadState(env: NodeJS.ProcessEnv) {
	const path = statePath(env);
	if (!existsSync(path)) throw new Error('No local development session is selected.');
	return JSON.parse(readFileSync(path, 'utf8')) as LocalSessionState;
}

function sha256(value: string | Buffer) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function sha512Integrity(value: Buffer) { return `sha512-${createHash('sha512').update(value).digest('base64')}`; }

function git(root: string, args: string[]) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }

function repositoryClosure(runtime: DevelopmentRuntime, worktree: string) {
	const status = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all']);
	const branch = git(worktree, ['branch', '--show-current']) || null;
	return { projectId: runtime.project.id, repository: runtime.project.repository, worktree, commit: git(worktree, ['rev-parse', 'HEAD']), branch, dirty: Boolean(status), dirtyDigest: status ? sha256(`${status}\n${git(worktree, ['diff', '--binary', 'HEAD'])}`) : null, recipeDigest: sha256(JSON.stringify(runtime)) };
}

function projectSelections(file: string): ProjectSelection[] {
	const root = dirname(file), document = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>;
	if (document.development) return [{ manifest: file, worktree: root }];
	if (!Array.isArray(document.projects) || document.projects.length === 0) throw new Error('Development session manifest requires a non-empty projects array.');
	return document.projects.map((project) => {
		if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Development project selection must be an object.');
		const input = project as Record<string, unknown>;
		if (typeof input.manifest !== 'string') throw new Error('Development project selection requires a manifest path.');
		const manifest = isAbsolute(input.manifest) ? input.manifest : resolve(root, input.manifest);
		const worktree = typeof input.worktree === 'string' ? (isAbsolute(input.worktree) ? input.worktree : resolve(root, input.worktree)) : dirname(manifest);
		return { manifest, worktree, ...(Array.isArray(input.targets) ? { targets: input.targets as ProjectSelection['targets'] } : {}) };
	});
}

function loadRuntimes(file: string) {
	return projectSelections(file).map((selection) => {
		const document = parseYaml(readFileSync(selection.manifest, 'utf8')) as { development?: unknown };
		return { selection, runtime: developmentRuntimeSchema.parse(document.development) };
	});
}

function hostCommand(handlerId: string, payload: unknown) {
	return { handlerId, arguments: [], options: { payload: JSON.stringify(payload) } };
}

async function invoke(context: CommandContext, handlerId: string, payload: unknown) {
	const command = hostCommand(handlerId, payload);
	return context.hostInvoke ? context.hostInvoke(command) : invokeLocalHostManager(command);
}

function parseSelection(value: string) {
	const match = /^([a-z][a-z0-9.-]{1,63})\.([a-z][a-z0-9.-]{1,63})=(released|candidate|live)$/u.exec(value);
	if (!match) throw new Error(`Invalid development selection ${value}; expected project.target=mode.`);
	return { projectId: match[1]!, targetId: match[2]!, mode: match[3]! as 'released' | 'candidate' | 'live' };
}

function selectedTarget(record: unknown, projectId: string, targetId: string) {
	const value = record as { runtimes?: DevelopmentRuntime[] };
	const runtime = value.runtimes?.find((entry) => entry.project.id === projectId);
	const target = runtime?.targets.find((entry) => entry.id === targetId);
	if (!runtime || !target) throw new Error(`Development target ${projectId}.${targetId} is not part of the current session.`);
	return { runtime, target };
}

function operationForMode(target: DevelopmentTarget, mode: string) {
	if (mode === 'released') return null;
	if (target.kind === 'package-watch') return target.operations.watch ?? target.operations.build ?? null;
	if (target.kind === 'rebuild-restart' || mode === 'candidate') return target.operations.build ?? target.operations.start ?? null;
	return target.operations.start ?? null;
}

export function developmentOperationEnvironment(state: Pick<LocalSessionState, 'manifest' | 'sessionId'>, worktree: string, mode: string, env: NodeJS.ProcessEnv, resolvedEnvironment: NodeJS.ProcessEnv = {}, operationEnvironment: NodeJS.ProcessEnv = {}) {
	return { ...env, ...resolvedEnvironment, TREESEED_DEVELOPMENT_SESSION_ID: state.sessionId, TREESEED_DEVELOPMENT_MODE: mode, TREESEED_DEVELOPMENT_WORKSPACE_ROOT: dirname(state.manifest), TREESEED_DEVELOPMENT_WORKTREE: worktree, ...operationEnvironment };
}

function runOneShotOperation(state: LocalSessionState, operation: NonNullable<DevelopmentTarget['operations']['setup']>, worktree: string, mode: string, env: NodeJS.ProcessEnv, resolvedEnvironment: NodeJS.ProcessEnv = {}) {
	const root = operation.cwd ? resolve(worktree, operation.cwd) : worktree;
	const result = spawnSync(operation.command, operation.args, { cwd: root, env: developmentOperationEnvironment(state, worktree, mode, env, resolvedEnvironment, operation.environment), stdio: 'inherit', timeout: operation.timeoutSeconds * 1_000 });
	if (result.status !== 0) throw new Error(`Development operation failed: ${operation.command} ${operation.args.join(' ')}.`);
}

function startOperation(state: LocalSessionState, runtime: DevelopmentRuntime, target: DevelopmentTarget, worktree: string, mode: string, env: NodeJS.ProcessEnv, resolvedEnvironment: NodeJS.ProcessEnv = {}) {
	const operation = operationForMode(target, mode);
	if (!operation) return null;
	const key = `${runtime.project.id}.${target.id}`;
	const existing = state.processes[key];
	if (existing) { try { process.kill(existing.pid, 0); return existing; } catch { delete state.processes[key]; } }
	const root = operation.cwd ? resolve(worktree, operation.cwd) : worktree;
	const log = resolve(developmentStateRoot(env), state.sessionId, `${key}.log`);
	mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
	const descriptor = openSync(log, 'a', 0o600);
	try {
		const child = spawn(operation.command, operation.args, { cwd: root, env: developmentOperationEnvironment(state, worktree, mode, env, resolvedEnvironment, operation.environment), detached: true, stdio: ['ignore', descriptor, descriptor] });
		child.unref(); if (!child.pid) throw new Error(`Failed to start ${key}.`);
		return state.processes[key] = { pid: child.pid, projectId: runtime.project.id, targetId: target.id, log };
	} finally { closeSync(descriptor); }
}

async function waitForDirectReadiness(target: DevelopmentTarget, timeoutSeconds: number) {
	if (!target.endpoints.length || target.ready.kind === 'marker' || target.ready.kind === 'process') return;
	const endpoint = target.endpoints[0]!, deadline = Date.now() + timeoutSeconds * 1_000;
	while (Date.now() < deadline) {
		try {
			if (target.ready.kind === 'http') { const response = await fetch(`http://127.0.0.1:${endpoint.port}${target.ready.path}`); if (response.status === target.ready.expectedStatus) return; }
			else { const result = spawnSync('bash', ['-c', `</dev/tcp/127.0.0.1/${endpoint.port}`], { stdio: 'ignore', timeout: 1_000 }); if (result.status === 0) return; }
		} catch { /* retry until the declared timeout */ }
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	throw new Error(`Readiness timed out for ${target.id}.`);
}

async function stopProcesses(state: LocalSessionState) {
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

function restoreOverlays(state: LocalSessionState, projectId?: string, removeGenerations = true) {
	const retained: LocalSessionState['overlays'] = [];
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

function installPackageOverlay(state: LocalSessionState, record: { session: { repositories: Array<{ projectId: string; worktree: string }> }; runtimes: DevelopmentRuntime[] }, runtime: DevelopmentRuntime, target: DevelopmentTarget, worktree: string, overlayRoot: string) {
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

function startPackageSynchronizer(state: LocalSessionState, runtime: DevelopmentRuntime, target: DevelopmentTarget, worktree: string, env: NodeJS.ProcessEnv) {
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

async function waitForPackageOverlay(target: DevelopmentTarget, worktree: string, overlayRoot: string) {
	const timeout = target.ready.kind === 'marker' ? target.ready.timeoutSeconds : 120, deadline = Date.now() + timeout * 1_000;
	while (Date.now() < deadline) {
		const markerReady = target.ready.kind !== 'marker' || existsSync(resolve(worktree, target.ready.path));
		if (markerReady && existsSync(resolve(overlayRoot, 'current'))) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Completed package generation timed out for ${target.id}.`);
}

function artifactPaths(pattern: string, root: string) {
	if (!pattern.includes('*')) return [resolve(root, pattern)];
	const directory = resolve(root, dirname(pattern)), expression = new RegExp(`^${basename(pattern).replaceAll('.', '\\.').replaceAll('*', '.*')}$`, 'u');
	return readdirSync(directory).filter((name) => expression.test(name)).map((name) => resolve(directory, name));
}

async function startSession(invocation: ParsedInvocation, context: CommandContext) {
	const manifest = resolve(context.cwd, invocation.arguments[0]!); const projects = loadRuntimes(manifest);
	const now = new Date(), requestedLease = Number(invocation.options.leaseSeconds ?? 14_400), leaseSeconds = Math.max(60, Math.min(86_400, requestedLease));
	const sessionId = `dev-${randomUUID().slice(0, 12)}`, expiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
	const targets = projects.flatMap(({ selection, runtime }) => (selection.targets ?? runtime.targets.map((target) => ({ id: target.id, mode: target.kind === 'rebuild-restart' ? 'candidate' as const : 'released' as const }))).map((target) => ({ projectId: runtime.project.id, targetId: target.id, mode: target.mode, generation: 0, health: target.mode === 'released' ? 'ready' as const : 'pending' as const })));
	const leases = projects.flatMap(({ selection, runtime }) => runtime.targets.filter((target) => targets.some((entry) => entry.projectId === runtime.project.id && entry.targetId === target.id && entry.mode !== 'released')).flatMap((target) => target.endpoints.filter((endpoint) => endpoint.canonicalAlias).map((endpoint) => ({ kind: 'alias' as const, resource: endpoint.canonicalAlias!, acquiredAt: now.toISOString(), expiresAt }))));
	const session = { schemaVersion: 'treeseed.development-session/v1' as const, sessionId, actor: String(invocation.options.actor ?? context.env.USER ?? 'local-developer'), hostId: 'local-host', createdAt: now.toISOString(), expiresAt, status: 'planning' as const, repositories: projects.map(({ selection, runtime }) => repositoryClosure(runtime, selection.worktree!)), targets, leases, restoredReceiptId: null, blockers: [] };
	if (invocation.options.plan === true) return { session, runtimes: projects.map(({ runtime }) => runtime), mutation: false };
	const result = await invoke(context, 'local.dev.session.start', { session, runtimes: projects.map(({ runtime }) => runtime) });
	saveState({ sessionId, manifest, processes: {}, overlays: [], candidates: [] }, context.env); return result;
}

async function useTargets(invocation: ParsedInvocation, context: CommandContext) {
	const state = loadState(context.env), sessionId = String(invocation.options.session ?? state.sessionId);
	const record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as { session: { repositories: Array<{ projectId: string; worktree: string }> }; runtimes: DevelopmentRuntime[] };
	const selections = [invocation.arguments[0]!, ...(Array.isArray(invocation.options.target) ? invocation.options.target : [])].map(parseSelection);
	if (invocation.options.plan === true) return { sessionId, selections, mutation: false };
	for (const selection of selections) {
		const { runtime, target } = selectedTarget(record, selection.projectId, selection.targetId);
		const repository = (record as { session: { repositories: Array<{ projectId: string; worktree: string }> } }).session.repositories.find((entry) => entry.projectId === selection.projectId);
		if (!repository) throw new Error(`No worktree is registered for ${selection.projectId}.`);
		if (selection.mode === 'released') {
			const processState = state.processes[`${selection.projectId}.${selection.targetId}`];
			if (processState) {
				await stopProcesses({ ...state, processes: { [`${selection.projectId}.${selection.targetId}`]: processState } });
				delete state.processes[`${selection.projectId}.${selection.targetId}`];
			}
			if (target.operations.cleanup) runOneShotOperation(state, target.operations.cleanup, repository.worktree, selection.mode, context.env);
			restoreOverlays(state, selection.projectId);
		} else {
			const resolved = await invoke(context, 'local.dev.environment', { sessionId, projectId: selection.projectId, targetId: selection.targetId }) as { environment?: NodeJS.ProcessEnv };
			if (target.operations.setup) runOneShotOperation(state, target.operations.setup, repository.worktree, selection.mode, context.env, resolved.environment ?? {});
			startOperation(state, runtime, target, repository.worktree, selection.mode, context.env, resolved.environment ?? {});
			saveState(state, context.env);
			if (target.kind === 'package-watch') {
				const overlayRoot = startPackageSynchronizer(state, runtime, target, repository.worktree, context.env);
				saveState(state, context.env);
				await waitForPackageOverlay(target, repository.worktree, overlayRoot); installPackageOverlay(state, record, runtime, target, repository.worktree, overlayRoot); saveState(state, context.env);
			} else await waitForDirectReadiness(target, target.ready.kind === 'process' ? target.ready.graceSeconds : target.ready.timeoutSeconds);
		}
		await invoke(context, 'local.dev.use', { sessionId, ...selection, ...(selection.mode !== 'released' && target.endpoints[0] ? { port: target.endpoints[0].port } : {}) });
	}
	saveState(state, context.env); return invoke(context, 'local.dev.status', { sessionId, all: false });
}

async function freeze(invocation: ParsedInvocation, context: CommandContext) {
	const state = loadState(context.env), sessionId = String(invocation.options.session ?? state.sessionId), record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as { session: { repositories: Array<{ projectId: string; worktree: string; dirty: boolean }>; targets: Array<{ projectId: string; targetId: string; mode: string }> }; runtimes: DevelopmentRuntime[] };
	const source = record.session.repositories.map((repository) => {
		const runtime = record.runtimes.find((entry) => entry.project.id === repository.projectId);
		if (!runtime) throw new Error(`Development runtime is missing for ${repository.projectId}.`);
		return repositoryClosure(runtime, repository.worktree);
	});
	const dirty = source.some((entry) => entry.dirty);
	if (dirty && invocation.options.allowDirty !== true) throw new Error('Freeze found dirty source; pass --allow-dirty to create a non-promotable candidate.');
	const artifacts: Array<{ projectId: string; targetId: string; kind: string; identity: string; digest: string; integrity?: string }> = [];
	for (const runtime of record.runtimes) for (const target of runtime.targets) if (target.freeze && record.session.targets.some((selected) => selected.projectId === runtime.project.id && selected.targetId === target.id && selected.mode !== 'released')) {
		const repository = record.session.repositories.find((entry) => entry.projectId === runtime.project.id)!;
		const result = spawnSync(target.freeze.operation.command, target.freeze.operation.args, { cwd: target.freeze.operation.cwd ? resolve(repository.worktree, target.freeze.operation.cwd) : repository.worktree, env: { ...context.env, ...target.freeze.operation.environment }, stdio: 'inherit', timeout: target.freeze.operation.timeoutSeconds * 1_000 });
		if (result.status !== 0) throw new Error(`Freeze failed for ${runtime.project.id}.${target.id}.`);
		for (const contractOperation of target.freeze.contractOperations) {
			const contract = spawnSync(contractOperation.command, contractOperation.args, { cwd: contractOperation.cwd ? resolve(repository.worktree, contractOperation.cwd) : repository.worktree, env: { ...context.env, ...contractOperation.environment }, stdio: 'inherit', timeout: contractOperation.timeoutSeconds * 1_000 });
			if (contract.status !== 0) throw new Error(`Contract generation failed for ${runtime.project.id}.${target.id}.`);
		}
		for (const pattern of target.freeze.artifacts) for (const path of artifactPaths(pattern, repository.worktree)) { const bytes = readFileSync(path); artifacts.push({ projectId: runtime.project.id, targetId: target.id, kind: target.freeze.kind, identity: basename(path), digest: sha256(bytes), ...(target.freeze.kind === 'npm-package' ? { integrity: sha512Integrity(bytes) } : {}) }); }
	}
	if (!artifacts.length) throw new Error('Selected development closure produced no declared freeze artifacts.');
	const candidateId = `candidate-${randomUUID().slice(0, 12)}`;
	const candidate = developmentCandidateSchema.parse({ schemaVersion: 'treeseed.development-candidate/v1', candidateId, sessionId, createdAt: new Date().toISOString(), source, artifacts, configurationDigest: sha256(JSON.stringify(record.runtimes)), dependencyGenerations: {}, compatibilityAttestations: [], verification: { status: 'pending', operations: [], completedAt: null }, promotable: false });
	const path = resolve(developmentStateRoot(context.env), sessionId, `${candidateId}.json`); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 }); state.candidates.push(path); saveState(state, context.env);
	await invoke(context, 'local.dev.candidate.register', { sessionId, candidate });
	return { candidate, receipt: path };
}

async function verifyCandidate(invocation: ParsedInvocation, context: CommandContext) {
	const state = loadState(context.env), sessionId = String(invocation.options.session ?? state.sessionId);
	const selected = typeof invocation.options.candidate === 'string' ? state.candidates.find((path) => path.includes(invocation.options.candidate as string)) : state.candidates.at(-1);
	if (!selected || !existsSync(selected)) throw new Error('No local development candidate is available for verification.');
	const candidate = developmentCandidateSchema.parse(JSON.parse(readFileSync(selected, 'utf8')));
	const record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as { session: { repositories: Array<{ projectId: string; worktree: string }> }; runtimes: DevelopmentRuntime[] };
	const operations: string[] = [];
	for (const artifact of candidate.artifacts) {
		const runtime = record.runtimes.find((entry) => entry.project.id === artifact.projectId), target = runtime?.targets.find((entry) => entry.id === artifact.targetId), repository = record.session.repositories.find((entry) => entry.projectId === artifact.projectId);
		if (!target?.operations.verify || !repository) continue;
		const operation = target.operations.verify, result = spawnSync(operation.command, operation.args, { cwd: operation.cwd ? resolve(repository.worktree, operation.cwd) : repository.worktree, env: { ...context.env, ...operation.environment }, stdio: 'inherit', timeout: operation.timeoutSeconds * 1_000 });
		operations.push(`${artifact.projectId}.${artifact.targetId}:${operation.command} ${operation.args.join(' ')}`);
		if (result.status !== 0) throw new Error(`Candidate verification failed for ${artifact.projectId}.${artifact.targetId}.`);
	}
	const verified = developmentCandidateSchema.parse({ ...candidate, verification: { status: 'passed', operations, completedAt: new Date().toISOString() }, promotable: !candidate.source.some((source) => source.dirty) });
	writeFileSync(selected, `${JSON.stringify(verified, null, 2)}\n`, { mode: 0o600 }); await invoke(context, 'local.dev.candidate.register', { sessionId, candidate: verified }); return { candidate: verified, receipt: selected };
}

export async function runDevelopment(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name === 'dev session start') return startSession(invocation, context);
	if (invocation.command.name === 'dev use') return useTargets(invocation, context);
	const state = loadState(context.env), sessionId = String(invocation.options.session ?? state.sessionId);
	if (invocation.command.name === 'dev session stop') {
		if (invocation.options.plan === true) return { sessionId, restore: true, mutation: false };
		const running = await stopProcesses(state);
		const active = new Set(running.map((entry) => `${entry.projectId}.${entry.targetId}`));
		for (const { selection, runtime } of loadRuntimes(state.manifest)) for (const target of runtime.targets) if (active.has(`${runtime.project.id}.${target.id}`) && target.operations.cleanup) runOneShotOperation(state, target.operations.cleanup, selection.worktree!, 'released', context.env);
		restoreOverlays(state); saveState(state, context.env); return invoke(context, 'local.dev.session.stop', { sessionId });
	}
	if (invocation.command.name === 'dev status') return invoke(context, 'local.dev.status', { ...(invocation.options.session ? { sessionId } : {}), all: invocation.options.all === true });
	if (invocation.command.name === 'dev plan') return invoke(context, 'local.dev.plan', { sessionId, selected: [] });
	if (invocation.command.name === 'dev logs') {
		const selected = typeof invocation.options.target === 'string' ? invocation.options.target : null;
		return { logs: Object.entries(state.processes).filter(([key]) => !selected || key === selected).map(([target, processState]) => ({ target, path: processState.log, bytes: existsSync(processState.log) ? statSync(processState.log).size : 0 })) };
	}
	if (invocation.command.name === 'dev rebuild') {
		const selection = parseSelection(`${invocation.arguments[0]}=candidate`); return invoke(context, 'local.dev.rebuild', { sessionId, projectId: selection.projectId, targetId: selection.targetId });
	}
	if (invocation.command.name === 'dev freeze') return freeze(invocation, context);
	if (invocation.command.name === 'dev verify') return verifyCandidate(invocation, context);
	throw new Error(`Unsupported development command ${invocation.command.name}.`);
}
