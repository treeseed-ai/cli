import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { invokeLocalHostManager } from '../../support/host-client.js';

interface DevelopmentFile { path: string; size: number; sha256: string }

function sha256(value: Buffer) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }

function files(root: string, directory: string): DevelopmentFile[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const absolute = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Host development build contains a symbolic link: ${relative(root, absolute)}.`);
		if (entry.isDirectory()) return files(root, absolute);
		if (!entry.isFile()) throw new Error(`Host development build contains an unsupported file: ${relative(root, absolute)}.`);
		const content = readFileSync(absolute);
		return [{ path: relative(root, absolute), size: content.byteLength, sha256: sha256(content) }];
	}).sort((left, right) => left.path.localeCompare(right.path));
}

export function hostDevelopmentRuntimeManifest(worktree: string) {
	const dependencies = ['@treeseed/sdk', '@treeseed/treedx', 'typescript', 'yaml', 'zod'];
	const roots = [resolve(worktree, 'dist'), ...dependencies.map((dependency) => resolve(worktree, 'node_modules', dependency))];
	for (const root of roots) if (!existsSync(root)) throw new Error(`Host development runtime dependency is missing: ${relative(worktree, root)}.`);
	const packageContent = readFileSync(resolve(worktree, 'package.json'));
	return [{ path: 'package.json', size: packageContent.byteLength, sha256: sha256(packageContent) }, ...roots.flatMap((root) => files(worktree, root))].sort((left, right) => left.path.localeCompare(right.path));
}

function defaultWorktree(cwd: string) {
	const candidates = [cwd, resolve(cwd, 'packages/deployment')];
	const selected = candidates.find((candidate) => existsSync(resolve(candidate, 'src/bin/supervisor.ts')) && existsSync(resolve(candidate, 'package.json')));
	if (!selected) throw new Error('Could not find the Deployment worktree. Pass it explicitly to `trsd dev host activate`.');
	return selected;
}

async function invoke(context: CommandContext, handlerId: string, payload: unknown) {
	const command = { handlerId, arguments: [], options: { payload: JSON.stringify(payload) } };
	return context.hostInvoke ? context.hostInvoke(command) : invokeLocalHostManager(command);
}

async function awaitActivation(context: CommandContext, generationId: string) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
		try {
			const status = await invoke(context, 'local.dev.host.status', {}) as { generationId?: string; status?: string; message?: string | null };
			if (status.generationId !== generationId) continue;
			if (status.status === 'active') return status;
			if (status.status === 'rolled-back') throw new Error(`Local host runtime failed health checks and was rolled back${status.message ? `: ${status.message}` : '.'}`);
		} catch (error) {
			if (error instanceof Error && error.message.includes('rolled back')) throw error;
			// The local manager socket is briefly unavailable while its service switches.
		}
	}
	throw new Error('Timed out waiting for the local host runtime to activate; run `trsd dev host status`.');
}

export async function runHostDevelopment(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name === 'dev host status') return invoke(context, 'local.dev.host.status', {});
	if (invocation.command.name === 'dev host deactivate') return invocation.options.plan === true ? { action: 'deactivate', mutation: false } : invoke(context, 'local.dev.host.deactivate', {});
	if (invocation.command.name !== 'dev host activate') throw new Error(`Unsupported host development command ${invocation.command.name}.`);
	const worktree = resolve(String(invocation.arguments[0] ?? defaultWorktree(context.cwd)));
	const packagePath = resolve(worktree, 'package.json');
	if (invocation.options.plan === true) return { action: 'activate', worktree, guestImageDigest: invocation.options.guestImage ?? null, mutation: false };
	if (!existsSync(packagePath) || basename(worktree) !== 'deployment') throw new Error('Host development activation requires the Deployment package worktree.');
	context.write('Building the local host runtime…', 'stdout');
	execFileSync('npm', ['run', 'build'], { cwd: worktree, env: context.env, stdio: 'inherit' });
	const manifest = hostDevelopmentRuntimeManifest(worktree);
	if (!manifest.some((entry) => entry.path === 'dist/src/bin/supervisor.js') || !manifest.some((entry) => entry.path === 'dist/src/bin/api.js') || !manifest.some((entry) => entry.path === 'dist/src/bin/sandbox-broker.js')) throw new Error('Host development build is missing a required runtime entrypoint.');
	const source = readFileSync(packagePath);
	const generationId = `dev-${Date.now()}-${randomUUID().slice(0, 8)}`;
	context.write(`Activating ${generationId} and checking host services…`, 'stdout');
	await invoke(context, 'local.dev.host.activate', { generationId, worktree, packageSha256: sha256(source), files: manifest, ...(typeof invocation.options.guestImage === 'string' ? { guestImageDigest: invocation.options.guestImage } : {}) });
	return awaitActivation(context, generationId);
}
