import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { loadAndPlanSeed } from '@treeseed/sdk/seeds';
import { getMachineConfigPaths, readConfigurationGeneration, settleConfigurationGeneration } from '@treeseed/sdk/workflow-support';
import type { CommandHandler, ParsedInvocation } from '../../types.js';
import { handleConfig } from '../configuration/config.js';
import { handleSeed } from '../seeds/seed.js';
import { handleDev } from './dev.js';
import { handleUpdate } from '../workspace-lifecycle/update.js';
import { fail } from '../utilities/utils.js';
import { platformSupervisorPaths, processIsAlive, readPlatformSupervisor, type PlatformSupervisorState } from './platform-supervisor-state.js';

type RunState = {
	schemaVersion: 1;
	seeds: string[];
	seedDigests: Record<string, string>;
	trackedBranch: string | null;
	configurationGenerationId: string | null;
	desiredGraphDigest: string;
	lastSuccessfulRuntimeGeneration: string | null;
	updatedAt: string;
};

function statePath(root: string) {
	return resolve(root, '.treeseed', 'run', 'state.json');
}

function readState(root: string): RunState | null {
	try {
		const parsed = JSON.parse(readFileSync(statePath(root), 'utf8')) as RunState;
		return parsed.schemaVersion === 1 && Array.isArray(parsed.seeds) ? parsed : null;
	} catch {
		return null;
	}
}

function trackedBranch(root: string) {
	const result = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root, encoding: 'utf8' });
	return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function desiredGraphDigest(seedDigests: Record<string, string>) {
	return createHash('sha256').update(JSON.stringify(Object.entries(seedDigests).sort(([left], [right]) => left.localeCompare(right)))).digest('hex');
}

function persistState(root: string, state: RunState) {
	const target = statePath(root);
	mkdirSync(dirname(target), { recursive: true });
	const temporary = `${target}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	renameSync(temporary, target);
}

function persistSupervisor(root: string, state: PlatformSupervisorState) {
	const target = platformSupervisorPaths(root).state; mkdirSync(dirname(target), { recursive: true });
	const temporary = `${target}.${process.pid}.tmp`; writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, target);
}

function commandInvocation(source: ParsedInvocation, action: string): ParsedInvocation {
	return invocationFor('platform', source, [action], { json: true });
}

async function convergeSupervisor(invocation: ParsedInvocation, context: Parameters<CommandHandler>[1], state: PlatformSupervisorState) {
	const generation = readConfigurationGeneration(context.cwd);
	try {
		const desired = readState(context.cwd);
		const foundation = await handleDev(invocationFor('dev', invocation, ['start'], { webRuntime: 'local', foundationOnly: true, seeds: desired?.seeds.join(','), json: true }), context);
		if ((foundation.exitCode ?? 0) !== 0) throw new Error(foundation.stderr?.join('\n') ?? 'Local platform foundation reconciliation failed.');
		for (const seed of desired?.seeds ?? []) {
			const applied = await handleSeed(invocationFor('seed', invocation, [seed], { apply: true, environments: 'local', yes: true, json: true }), context);
			if ((applied.exitCode ?? 0) !== 0) throw new Error(applied.stderr?.join('\n') ?? `Seed ${seed} reconciliation failed.`);
		}
		const runtime = await handleDev(invocationFor('dev', invocation, ['start'], { webRuntime: 'local', seeds: desired?.seeds.join(','), json: true }), context);
		if ((runtime.exitCode ?? 0) !== 0) throw new Error(runtime.stderr?.join('\n') ?? 'Local runtime reconciliation failed.');
		state.lastConvergedAt = new Date().toISOString(); state.lastError = undefined;
		if (generation?.status === 'pending') { settleConfigurationGeneration(context.cwd, generation.id, 'applied', { runtimeReady: true }); state.generationId = generation.id; }
		if (desired) persistState(context.cwd, { ...desired, configurationGenerationId: generation?.id ?? desired.configurationGenerationId, lastSuccessfulRuntimeGeneration: generation?.id ?? desired.lastSuccessfulRuntimeGeneration, updatedAt: state.lastConvergedAt });
	} catch (error) {
		state.lastError = error instanceof Error ? error.message : String(error);
		if (generation?.status === 'pending') settleConfigurationGeneration(context.cwd, generation.id, 'failed', { error: state.lastError });
	}
	persistSupervisor(context.cwd, state);
}

async function pollRemote(invocation: ParsedInvocation, context: Parameters<CommandHandler>[1], state: PlatformSupervisorState) {
	state.lastRemotePollAt = new Date().toISOString();
	const result = await handleUpdate(invocationFor('update', invocation, [], { strategy: 'ff-only', noPush: true, tracking: true, workspaceLinks: 'auto' }), context);
	if ((result.exitCode ?? 0) !== 0) state.lastError = result.stderr?.join('\n') ?? 'Remote tracking branch reconciliation is blocked.';
	else await convergeSupervisor(invocation, context, state);
	persistSupervisor(context.cwd, state);
}

async function supervise(invocation: ParsedInvocation, context: Parameters<CommandHandler>[1]) {
	const state: PlatformSupervisorState = { pid: process.pid, startedAt: new Date().toISOString() };
	persistSupervisor(context.cwd, state); await convergeSupervisor(invocation, context, state);
	const stop = () => process.exit(0); process.once('SIGTERM', stop); process.once('SIGINT', stop);
	const interval = Math.max(15_000, Number(context.env.TREESEED_PLATFORM_POLL_INTERVAL_MS ?? 30_000));
	let polling = false;
	await new Promise<void>((resolvePromise) => {
		const timer = setInterval(() => {
			if (polling) return;
			polling = true;
			void pollRemote(invocation, context, state).finally(() => { polling = false; });
		}, interval);
		process.once('beforeExit', () => { clearInterval(timer); resolvePromise(); });
	});
	return { exitCode: 0, report: { command: 'platform supervise', ok: true } };
}

function systemdQuote(value: string) { return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`; }
export function renderPlatformUserService(input: { root: string; executable: string; entrypoint: string; pathValue?: string }) {
	const pathEntries = [dirname(input.executable), ...(input.pathValue ?? '').split(':')].filter(Boolean);
	const runtimePath = [...new Set(pathEntries)].join(':');
	return `[Unit]\nDescription=TreeSeed local platform (${input.root})\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${input.root}\nEnvironment=${systemdQuote(`PATH=${runtimePath}`)}\nExecStart=${systemdQuote(input.executable)} ${systemdQuote(input.entrypoint)} platform supervise --json\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
}
function reconcileUserService(root: string) {
	if (process.platform !== 'linux' || !process.argv[1]) return { supported: false, installed: false };
	const scope = Buffer.from(root).toString('base64url').slice(0, 20).toLowerCase();
	const directory = resolve(homedir(), '.config', 'systemd', 'user'); const path = resolve(directory, `treeseed-platform-${scope}.service`);
	const content = renderPlatformUserService({ root, executable: process.execPath, entrypoint: resolve(process.argv[1]), pathValue: process.env.PATH });
	mkdirSync(directory, { recursive: true }); if (!existsSync(path) || readFileSync(path, 'utf8') !== content) writeFileSync(path, content, 'utf8');
	const unit = `treeseed-platform-${scope}.service`;
	const existing = readPlatformSupervisor(root);
	if (existing && processIsAlive(existing.pid)) process.kill(existing.pid, 'SIGTERM');
	const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
	const enable = reload.status === 0 ? spawnSync('systemctl', ['--user', 'enable', unit], { stdio: 'ignore' }) : null;
	const restart = enable?.status === 0 ? spawnSync('systemctl', ['--user', 'restart', unit], { stdio: 'ignore' }) : null;
	const pidResult = restart?.status === 0
		? spawnSync('systemctl', ['--user', 'show', unit, '--property', 'MainPID', '--value'], { encoding: 'utf8' })
		: null;
	const pid = Number.parseInt(pidResult?.stdout.trim() ?? '', 10);
	return { supported: true, installed: true, enabled: enable?.status === 0, active: restart?.status === 0, pid: Number.isFinite(pid) && pid > 0 ? pid : null, path, unit };
}

function startSupervisor(root: string) {
	const existing = readPlatformSupervisor(root);
	const replacedPid = existing && processIsAlive(existing.pid) ? existing.pid : null;
	if (replacedPid) process.kill(replacedPid, 'SIGTERM');
	const paths = platformSupervisorPaths(root); mkdirSync(dirname(paths.log), { recursive: true }); appendFileSync(paths.log, `\n[platform] starting ${new Date().toISOString()}\n`);
	const log = openSync(paths.log, 'a');
	const child = spawn(process.execPath, [resolve(process.argv[1]!), 'platform', 'supervise', '--json'], { cwd: root, detached: true, stdio: ['ignore', log, log] });
	child.unref(); closeSync(log);
	return { started: true, pid: child.pid ?? null, replacedPid };
}

function seedDigest(plan: NonNullable<ReturnType<typeof loadAndPlanSeed>['plan']>) {
	return [
		...plan.actions.map((entry) => `${entry.kind}:${entry.key}:${JSON.stringify(entry.payload ?? {})}`),
		...plan.runtime.capacityProviders.map((entry) => `capacityProvider:${entry.key}:${JSON.stringify(entry)}`),
		...plan.runtime.agentLabServicePrincipals.map((entry) => `servicePrincipal:${entry.key}:${JSON.stringify(entry)}`),
	].sort().join('|');
}

export function compileSeedSet(root: string, seeds: string[]) {
	const selected = seeds.map((seed) => ({ seed, loaded: loadAndPlanSeed({ projectRoot: root, seedName: seed, environments: 'local', mode: 'plan' }) }));
	const diagnostics = selected.flatMap(({ seed, loaded }) => loaded.diagnostics.map((entry) => ({ ...entry, seed })));
	const missing = selected.filter(({ loaded }) => !loaded.plan).map(({ seed }) => seed);
	if (missing.length || diagnostics.some((entry) => entry.severity === 'error')) return { ok: false as const, diagnostics, missing };
	const ownership = new Map<string, { seed: string; payload: string }>();
	const registerOwnership = (seed: string, identity: string, value: unknown) => {
		const payload = JSON.stringify(value ?? {});
		const prior = ownership.get(identity);
		if (prior && prior.payload !== payload) diagnostics.push({ seed, severity: 'error', code: 'seed.desired_identity_conflict', message: `${identity} conflicts with seed ${prior.seed}.`, path: identity });
		else ownership.set(identity, { seed, payload });
	};
	for (const { seed, loaded } of selected) {
		for (const action of loaded.plan!.actions) {
			const identity = `${action.kind}:${action.key}`;
			registerOwnership(seed, identity, action.payload);
		}
		for (const provider of loaded.plan!.runtime.capacityProviders) registerOwnership(seed, `capacityProvider:${provider.key}`, provider);
		for (const principal of loaded.plan!.runtime.agentLabServicePrincipals) registerOwnership(seed, `servicePrincipal:${principal.key}`, principal);
	}
	return {
		ok: !diagnostics.some((entry) => entry.severity === 'error'),
		diagnostics,
		missing,
		plans: selected.map(({ seed, loaded }) => ({ seed, plan: loaded.plan! })),
	};
}

function invocationFor(commandName: string, source: ParsedInvocation, positionals: string[], args: Record<string, string | string[] | boolean | undefined>): ParsedInvocation {
	return { commandName, rawArgs: source.rawArgs, positionals, args };
}

export const handleRun: CommandHandler = async (invocation, context) => {
	const prior = readState(context.cwd);
	const requested = [...new Set((invocation.positionals.length ? invocation.positionals : prior?.seeds ?? ['treeseed']).map((entry) => entry.trim()).filter(Boolean))];
	if (!requested.length) return fail('`trsd run` requires at least one seed or a previously persisted seed set.');
	const compiled = compileSeedSet(context.cwd, requested);
	if (!compiled.ok) return { exitCode: 1, stderr: compiled.diagnostics.map((entry) => `${entry.seed}: ${entry.code}: ${entry.message}`), report: { command: 'run', ok: false, requestedSeeds: requested, diagnostics: compiled.diagnostics } };
	const removedSeeds = (prior?.seeds ?? []).filter((seed) => !requested.includes(seed));
	if (removedSeeds.length && invocation.args.yes !== true && invocation.args.plan !== true) return fail(`Removing active seeds requires --yes: ${removedSeeds.join(', ')}.`);
	const seedDigests = Object.fromEntries(compiled.plans!.map(({ seed, plan }) => [seed, seedDigest(plan)]));
	if (invocation.args.plan === true) {
		const platform = await handleDev(invocationFor('dev', invocation, ['start'], { webRuntime: 'local', seeds: requested.join(','), plan: true, json: true }), context);
		if ((platform.exitCode ?? 0) !== 0) return { ...platform, report: { ...(platform.report ?? {}), command: 'run', executionMode: 'plan', requestedSeeds: requested } };
		return { exitCode: 0, report: {
			command: 'run', ok: true, executionMode: 'plan', requestedSeeds: requested, removedSeeds, seedDigests,
			plans: compiled.plans!.map(({ seed, plan }) => ({ seed, summary: plan.summary, actions: plan.actions })),
			platform: platform.report ?? null,
		} };
	}

	const { configPath } = getMachineConfigPaths(context.cwd);
	if (!existsSync(configPath)) {
		if (context.outputFormat === 'json' || context.interactiveUi === false || !process.stdin.isTTY) return fail('TreeSeed configuration is missing. Run `trsd config` interactively, then repeat `trsd run`.');
		const configured = await handleConfig(invocationFor('config', invocation, [], {}), context);
		if ((configured.exitCode ?? 0) !== 0) return configured;
	}

	const foundation = await handleDev(invocationFor('dev', invocation, ['start'], { webRuntime: 'local', foundationOnly: true, json: invocation.args.json }), context);
	if ((foundation.exitCode ?? 0) !== 0) return foundation;
	const applied = [];
	for (const seed of requested) {
		const result = await handleSeed(invocationFor('seed', invocation, [seed], { apply: true, environments: 'local', yes: invocation.args.yes, json: invocation.args.json }), context);
		if ((result.exitCode ?? 0) !== 0) return { ...result, report: { ...(result.report ?? {}), command: 'run', failedSeed: seed, platformStarted: true } };
		applied.push({ seed, report: result.report ?? null });
	}
	const started = await handleDev(invocationFor('dev', invocation, ['start'], { webRuntime: 'local', seeds: requested.join(','), json: invocation.args.json }), context);
	if ((started.exitCode ?? 0) !== 0) return started;
	const generation = readConfigurationGeneration(context.cwd);
	persistState(context.cwd, { schemaVersion: 1, seeds: requested, seedDigests, trackedBranch: trackedBranch(context.cwd), configurationGenerationId: generation?.id ?? null, desiredGraphDigest: desiredGraphDigest(seedDigests), lastSuccessfulRuntimeGeneration: generation?.status === 'applied' ? generation.id : null, updatedAt: new Date().toISOString() });
	if (invocation.args.foreground === true) {
		const existing = readPlatformSupervisor(context.cwd);
		if (existing && processIsAlive(existing.pid)) process.kill(existing.pid, 'SIGTERM');
		return supervise(commandInvocation(invocation, 'supervise'), context);
	}
	const userService = reconcileUserService(context.cwd);
	const supervisor = userService.supported && userService.active
		? { started: true, pid: userService.pid, managedBy: 'systemd-user' }
		: startSupervisor(context.cwd);
	return { exitCode: 0, message: `TreeSeed is ready with ${requested.join(', ')}.`, report: { command: 'run', ok: true, detached: true, seeds: requested, removedSeeds, seedDigests, foundation: foundation.report ?? null, platform: started.report ?? null, applied, supervisor, userService } };
};

export const handlePlatform: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	if (action === 'supervise') return supervise(invocation, context);
	if (!['status', 'logs', 'stop'].includes(action)) return fail('Usage: trsd platform status|logs|stop');
	const result = await handleDev(invocationFor('dev', invocation, [action], { ...invocation.args, json: invocation.args.json }), context);
	const supervisor = readPlatformSupervisor(context.cwd);
	if (action === 'stop' && invocation.args.plan !== true && supervisor && processIsAlive(supervisor.pid)) process.kill(supervisor.pid, 'SIGTERM');
	return { ...result, report: { ...(result.report ?? {}), supervisor: supervisor ? { ...supervisor, running: processIsAlive(supervisor.pid), logPath: platformSupervisorPaths(context.cwd).log } : null } };
};
