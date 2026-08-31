import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentCandidateSchema, developmentRuntimeSchema, type DevelopmentRuntime, type DevelopmentTarget } from '@treeseed/sdk/development';
import { parse as parseYaml } from 'yaml';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { invokeLocalHostManager } from '../support/host-client.js';
import { developmentStateRoot, selectDevelopmentCli } from './development-cli-selection.js';
import { dependentReactions, installPackageOverlay, overlayGeneration, relativeOverlayTarget, restoreOverlays, startPackageSynchronizer, stopProcess, stopProcesses, waitForNewPackageOverlay, waitForPackageOverlay } from './development-support/overlays.js';
import { artifactPaths, compatibilityAttestations, withFreezeLock } from './development-support/candidate.js';
import { runHostDevelopment } from './development-support/host-runtime.js';
export { relativeOverlayTarget, startPackageSynchronizer, stopProcess, waitForNewPackageOverlay } from './development-support/overlays.js';

export { developmentCliEntrypointPath, selectDevelopmentCli } from './development-cli-selection.js';

interface LocalSessionState {
	sessionId: string;
	manifest: string;
	processes: Record<string, { pid: number; projectId: string; targetId: string; log: string }>;
	overlays: Array<{ projectId: string; packageName: string; link: string; backup: string | null; overlayRoot: string }>;
	candidates: string[];
}

interface ProjectSelection { manifest: string; worktree?: string; targets?: Array<{ id: string; mode: 'released' | 'candidate' | 'live' }> }

interface DevelopmentStatusRecord {
	session: {
		targets: Array<{ projectId: string; targetId: string; mode: 'released' | 'candidate' | 'live'; generation: number; health?: string }>;
		repositories: Array<{ projectId: string; worktree: string }>;
	};
	runtimes: DevelopmentRuntime[];
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

function repositoryClosure(runtime: DevelopmentRuntime, worktree: string, excludedPaths: string[] = []) {
	const pathspec = excludedPaths.length ? ['--', '.', ...excludedPaths.map((path) => `:(exclude)${path}`)] : [];
	const status = git(worktree, ['status', '--porcelain=v1', '--untracked-files=all', ...pathspec]);
	const branch = git(worktree, ['branch', '--show-current']) || null;
	return { projectId: runtime.project.id, repository: runtime.project.repository, worktree, commit: git(worktree, ['rev-parse', 'HEAD']), branch, dirty: Boolean(status), dirtyDigest: status ? sha256(`${status}\n${git(worktree, ['diff', '--binary', 'HEAD', ...pathspec])}`) : null, recipeDigest: sha256(JSON.stringify(runtime)) };
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
	if (target.kind === 'rebuild-restart') return target.operations.start ?? null;
	if (mode === 'candidate') return target.operations.build ?? target.operations.start ?? null;
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

function operationIsRunning(state: LocalSessionState, key: string) {
	const existing = state.processes[key]; if (!existing) return false;
	try { process.kill(existing.pid, 0); return true; } catch { delete state.processes[key]; return false; }
}

async function waitForDirectReadiness(target: DevelopmentTarget, timeoutSeconds: number, state?: LocalSessionState, key?: string) {
	if (target.ready.kind === 'process') {
		if (!state || !key) throw new Error(`Process readiness for ${target.id} requires tracked process state.`);
		const deadline = Date.now() + timeoutSeconds * 1_000;
		while (Date.now() < deadline) {
			if (!operationIsRunning(state, key)) throw new Error(`Development process ${key} exited before becoming ready.`);
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		}
		if (!operationIsRunning(state, key)) throw new Error(`Development process ${key} exited before becoming ready.`);
		return;
	}
	if (!target.endpoints.length || target.ready.kind === 'marker') return;
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
	const record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as { session: { expiresAt: string; repositories: Array<{ projectId: string; worktree: string }> }; runtimes: DevelopmentRuntime[] };
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
			if (target.operations.cleanup) runOneShotOperation(state, target.operations.cleanup, repository.worktree, selection.mode, context.env, { TREESEED_DEVELOPMENT_CLEANUP_SCOPE: 'session' });
			restoreOverlays(state, selection.projectId);
			if (selection.projectId === 'cli' && selection.targetId === 'package') selectDevelopmentCli(context.env, null);
		} else {
			const resolved = await invoke(context, 'local.dev.environment', { sessionId, projectId: selection.projectId, targetId: selection.targetId }) as { environment?: NodeJS.ProcessEnv };
			if (target.operations.setup) runOneShotOperation(state, target.operations.setup, repository.worktree, selection.mode, context.env, resolved.environment ?? {});
			const running = operationIsRunning(state, `${runtime.project.id}.${target.id}`);
			if (target.kind === 'rebuild-restart' && target.operations.build && !running) runOneShotOperation(state, target.operations.build, repository.worktree, selection.mode, context.env, resolved.environment ?? {});
			startOperation(state, runtime, target, repository.worktree, selection.mode, context.env, resolved.environment ?? {});
			saveState(state, context.env);
			if (target.kind === 'package-watch') {
				const cliWorktree = record.session.repositories.find((entry) => entry.projectId === 'cli')?.worktree;
				const overlayRoot = startPackageSynchronizer(state, runtime, target, repository.worktree, context.env, cliWorktree);
				saveState(state, context.env);
				await waitForPackageOverlay(target, repository.worktree, overlayRoot); installPackageOverlay(state, record, runtime, target, repository.worktree, overlayRoot); saveState(state, context.env);
				if (selection.projectId === 'cli' && selection.targetId === 'package') selectDevelopmentCli(context.env, { entrypoint: resolve(overlayRoot, 'current', 'dist', 'cli', 'main.js'), expiresAt: record.session.expiresAt });
			} else await waitForDirectReadiness(target, target.ready.kind === 'process' ? target.ready.graceSeconds : target.ready.timeoutSeconds, state, `${runtime.project.id}.${target.id}`);
		}
		await invoke(context, 'local.dev.use', { sessionId, ...selection, ...(selection.mode !== 'released' && target.endpoints[0] ? { port: target.endpoints[0].port } : {}) });
	}
	saveState(state, context.env); return invoke(context, 'local.dev.status', { sessionId, all: false });
}

async function freeze(invocation: ParsedInvocation, context: CommandContext) {
	const state = loadState(context.env), sessionId = String(invocation.options.session ?? state.sessionId), record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as { session: { repositories: Array<{ projectId: string; worktree: string; dirty: boolean }>; targets: Array<{ projectId: string; targetId: string; mode: string; generation: number }> }; runtimes: DevelopmentRuntime[] };
	return withFreezeLock(context.env, sessionId, async () => {
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
		for (const pattern of target.freeze.artifacts) for (const path of artifactPaths(pattern, repository.worktree)) { const bytes = readFileSync(path); artifacts.push({ projectId: runtime.project.id, targetId: target.id, kind: target.freeze.kind, identity: relative(repository.worktree, path), digest: sha256(bytes), ...(target.freeze.kind === 'npm-package' ? { integrity: sha512Integrity(bytes) } : {}) }); }
		}
		if (!artifacts.length) throw new Error('Selected development closure produced no declared freeze artifacts.');
		const candidateId = `candidate-${randomUUID().slice(0, 12)}`;
		const dependencyGenerations = Object.fromEntries(record.session.targets.map((target) => [`${target.projectId}.${target.targetId}`, target.generation]));
		const candidate = developmentCandidateSchema.parse({ schemaVersion: 'treeseed.development-candidate/v1', candidateId, sessionId, createdAt: new Date().toISOString(), source, artifacts, configurationDigest: sha256(JSON.stringify(record.runtimes)), dependencyGenerations, compatibilityAttestations: compatibilityAttestations(record.session.repositories), verification: { status: 'pending', operations: [], completedAt: null }, promotable: false });
		const path = resolve(developmentStateRoot(context.env), sessionId, `${candidateId}.json`); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 }); state.candidates.push(path); saveState(state, context.env);
		await invoke(context, 'local.dev.candidate.register', { sessionId, candidate });
		return { candidate, receipt: path };
	});
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
		const artifactPath = resolve(repository.worktree, artifact.identity);
		const artifactRelative = relative(repository.worktree, artifactPath);
		if (artifactRelative.startsWith('..') || isAbsolute(artifactRelative)) throw new Error(`Candidate artifact identity escapes its source repository: ${artifact.identity}.`);
		if (!existsSync(artifactPath) || sha256(readFileSync(artifactPath)) !== artifact.digest) throw new Error(`Candidate artifact custody failed before verification: ${artifact.identity}.`);
		const operation = target.operations.verify, result = spawnSync(operation.command, operation.args, { cwd: operation.cwd ? resolve(repository.worktree, operation.cwd) : repository.worktree, env: { ...context.env, ...operation.environment }, stdio: 'inherit', timeout: operation.timeoutSeconds * 1_000 });
		operations.push(`${artifact.projectId}.${artifact.targetId}:${operation.command} ${operation.args.join(' ')}`);
		if (result.status !== 0) throw new Error(`Candidate verification failed for ${artifact.projectId}.${artifact.targetId}.`);
		if (!existsSync(artifactPath) || sha256(readFileSync(artifactPath)) !== artifact.digest) throw new Error(`Candidate verification rebuilt or changed sealed artifact ${artifact.identity}.`);
	}
	if (!operations.length) throw new Error('Candidate verification requires at least one declared verification operation.');
	for (const source of candidate.source) {
		const runtime = record.runtimes.find((entry) => entry.project.id === source.projectId);
		const repository = record.session.repositories.find((entry) => entry.projectId === source.projectId);
		const artifactPaths = candidate.artifacts.filter((artifact) => artifact.projectId === source.projectId).map((artifact) => artifact.identity);
		if (!runtime || !repository || JSON.stringify(repositoryClosure(runtime, repository.worktree, artifactPaths)) !== JSON.stringify(source)) throw new Error(`Candidate source changed after freeze: ${source.projectId}.`);
	}
	const verified = developmentCandidateSchema.parse({ ...candidate, verification: { status: 'passed', operations, completedAt: new Date().toISOString() }, promotable: !candidate.source.some((source) => source.dirty) });
	writeFileSync(selected, `${JSON.stringify(verified, null, 2)}\n`, { mode: 0o600 }); await invoke(context, 'local.dev.candidate.register', { sessionId, candidate: verified }); return { candidate: verified, receipt: selected };
}

async function markRebuilt(context: CommandContext, sessionId: string, projectId: string, targetId: string, mode: 'candidate' | 'live', target: DevelopmentTarget) {
	await invoke(context, 'local.dev.rebuild', { sessionId, projectId, targetId });
	await invoke(context, 'local.dev.use', { sessionId, projectId, targetId, mode, ...(target.endpoints[0] ? { port: target.endpoints[0].port } : {}) });
}

async function rebuildPackage(input: { state: LocalSessionState; runtime: DevelopmentRuntime; target: DevelopmentTarget; worktree: string; mode: 'candidate' | 'live'; context: CommandContext }) {
	const { state, runtime, target, worktree, mode, context } = input;
	if (!target.operations.build) throw new Error(`${runtime.project.id}.${target.id} does not declare a rebuild operation.`);
	const overlayRoot = resolve(worktree, '.treeseed', 'cache', 'development-sessions', state.sessionId, target.id);
	const previous = overlayGeneration(overlayRoot);
	runOneShotOperation(state, target.operations.build, worktree, mode, context.env);
	await waitForNewPackageOverlay(target, worktree, overlayRoot, previous);
	await markRebuilt(context, state.sessionId, runtime.project.id, target.id, mode, target);
}

async function restartConsumer(input: { state: LocalSessionState; runtime: DevelopmentRuntime; target: DevelopmentTarget; worktree: string; mode: 'candidate' | 'live'; context: CommandContext; recordGeneration?: boolean }) {
	const { state, runtime, target, worktree, mode, context } = input, key = `${runtime.project.id}.${target.id}`;
	await stopProcess(state, key);
	if (target.operations.cleanup) runOneShotOperation(state, target.operations.cleanup, worktree, mode, context.env, { TREESEED_DEVELOPMENT_CLEANUP_SCOPE: 'runtime' });
	const resolved = await invoke(context, 'local.dev.environment', { sessionId: state.sessionId, projectId: runtime.project.id, targetId: target.id }) as { environment?: NodeJS.ProcessEnv };
	if (target.operations.setup) runOneShotOperation(state, target.operations.setup, worktree, mode, context.env, resolved.environment ?? {});
	startOperation(state, runtime, target, worktree, mode, context.env, resolved.environment ?? {});
	saveState(state, context.env);
	await waitForDirectReadiness(target, target.ready.kind === 'process' ? target.ready.graceSeconds : target.ready.timeoutSeconds, state, key);
	if (input.recordGeneration !== false) await markRebuilt(context, state.sessionId, runtime.project.id, target.id, mode, target);
}

async function restart(invocation: ParsedInvocation, context: CommandContext, state: LocalSessionState, sessionId: string) {
	const selection = parseSelection(`${invocation.arguments[0]}=candidate`);
	const record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as DevelopmentStatusRecord;
	const selected = record.session.targets.find((entry) => entry.projectId === selection.projectId && entry.targetId === selection.targetId);
	if (!selected || selected.mode === 'released') throw new Error(`${selection.projectId}.${selection.targetId} is not selected for local development.`);
	const { runtime, target } = selectedTarget(record, selection.projectId, selection.targetId);
	if (target.kind === 'package-watch') throw new Error('Package-watch targets rebuild atomically and do not support restart.');
	const repository = record.session.repositories.find((entry) => entry.projectId === selection.projectId);
	if (!repository) throw new Error(`No worktree is registered for ${selection.projectId}.`);
	await restartConsumer({ state, runtime, target, worktree: repository.worktree, mode: selected.mode as 'candidate' | 'live', context, recordGeneration: false });
	await invoke(context, 'local.dev.use', { sessionId, projectId: selection.projectId, targetId: selection.targetId, mode: selected.mode });
	saveState(state, context.env);
	return { sessionId, target: `${selection.projectId}.${selection.targetId}`, restarted: true, record: await invoke(context, 'local.dev.status', { sessionId, all: false }) };
}

async function rebuild(invocation: ParsedInvocation, context: CommandContext, state: LocalSessionState, sessionId: string) {
	const selection = parseSelection(`${invocation.arguments[0]}=candidate`);
	const record = await invoke(context, 'local.dev.status', { sessionId, all: false }) as DevelopmentStatusRecord;
	const selected = record.session.targets.find((entry) => entry.projectId === selection.projectId && entry.targetId === selection.targetId);
	if (!selected || selected.mode === 'released') throw new Error(`${selection.projectId}.${selection.targetId} is not selected for local development.`);
	const { runtime, target } = selectedTarget(record, selection.projectId, selection.targetId);
	const repository = record.session.repositories.find((entry) => entry.projectId === selection.projectId);
	if (!repository) throw new Error(`No worktree is registered for ${selection.projectId}.`);
	const mode = selected.mode as 'candidate' | 'live';
	if (invocation.options.plan === true) return {
		sessionId,
		target: `${selection.projectId}.${selection.targetId}`,
		mode,
		mutation: false,
	};
	if (target.kind === 'package-watch') await rebuildPackage({ state, runtime, target, worktree: repository.worktree, mode, context });
	else if (target.kind === 'rebuild-restart') {
		if (!target.operations.build) throw new Error(`${selection.projectId}.${selection.targetId} does not declare a build operation.`);
		runOneShotOperation(state, target.operations.build, repository.worktree, mode, context.env);
		await restartConsumer({ state, runtime, target, worktree: repository.worktree, mode, context });
	} else await restartConsumer({ state, runtime, target, worktree: repository.worktree, mode, context });
	const manual: string[] = [];
	for (const dependent of dependentReactions(record.runtimes, selection.projectId, selection.targetId)) {
		const dependentSelection = record.session.targets.find((entry) => entry.projectId === dependent.runtime.project.id && entry.targetId === dependent.target.id);
		const dependentRepository = record.session.repositories.find((entry) => entry.projectId === dependent.runtime.project.id);
		if (!dependentSelection || dependentSelection.mode === 'released' || !dependentRepository) continue;
		if (dependent.reaction === 'manual') { manual.push(`${dependent.runtime.project.id}.${dependent.target.id}`); continue; }
		const dependentInput = { state, runtime: dependent.runtime, target: dependent.target, worktree: dependentRepository.worktree, mode: dependentSelection.mode as 'candidate' | 'live', context };
		if (dependent.reaction === 'rebuild' && dependent.target.kind === 'package-watch') await rebuildPackage(dependentInput);
		else if (dependent.reaction === 'rebuild' && dependent.target.operations.build) {
			runOneShotOperation(state, dependent.target.operations.build, dependentRepository.worktree, dependentSelection.mode, context.env);
			await markRebuilt(context, sessionId, dependent.runtime.project.id, dependent.target.id, dependentSelection.mode, dependent.target);
		} else await restartConsumer(dependentInput);
	}
	saveState(state, context.env);
	return { sessionId, target: `${selection.projectId}.${selection.targetId}`, manual, record: await invoke(context, 'local.dev.status', { sessionId, all: false }) };
}

export async function runDevelopment(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name.startsWith('dev host ')) return runHostDevelopment(invocation, context);
	if (invocation.command.name === 'dev session start') return startSession(invocation, context);
	if (invocation.command.name === 'dev use') return useTargets(invocation, context);
	const state = loadState(context.env), sessionId = String(invocation.options.session ?? state.sessionId);
	if (invocation.command.name === 'dev session stop') {
		if (invocation.options.plan === true) return { sessionId, restore: true, mutation: false };
		const running = await stopProcesses(state);
		const active = new Set(running.map((entry) => `${entry.projectId}.${entry.targetId}`));
		for (const { selection, runtime } of loadRuntimes(state.manifest)) for (const target of runtime.targets) if (active.has(`${runtime.project.id}.${target.id}`) && target.operations.cleanup) runOneShotOperation(state, target.operations.cleanup, selection.worktree!, 'released', context.env, { TREESEED_DEVELOPMENT_CLEANUP_SCOPE: 'session' });
		restoreOverlays(state); selectDevelopmentCli(context.env, null); saveState(state, context.env); return invoke(context, 'local.dev.session.stop', { sessionId });
	}
	if (invocation.command.name === 'dev status') return invoke(context, 'local.dev.status', { ...(invocation.options.session ? { sessionId } : {}), all: invocation.options.all === true });
	if (invocation.command.name === 'dev plan') return invoke(context, 'local.dev.plan', { sessionId, selected: [] });
	if (invocation.command.name === 'dev logs') {
		const selected = typeof invocation.options.target === 'string' ? invocation.options.target : null;
		return { logs: Object.entries(state.processes).filter(([key]) => !selected || key === selected).map(([target, processState]) => ({ target, path: processState.log, bytes: existsSync(processState.log) ? statSync(processState.log).size : 0 })) };
	}
	if (invocation.command.name === 'dev rebuild') {
		return rebuild(invocation, context, state, sessionId);
	}
	if (invocation.command.name === 'dev restart') return restart(invocation, context, state, sessionId);
	if (invocation.command.name === 'dev freeze') return freeze(invocation, context);
	if (invocation.command.name === 'dev verify') return verifyCandidate(invocation, context);
	throw new Error(`Unsupported development command ${invocation.command.name}.`);
}
