import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { invokeLocalHostManager } from '../../support/host-client.js';
import { hostDependencyRoots } from './host-dependencies.js';

interface DevelopmentFile { path: string; size: number; sha256: string }

function sha256(value: Buffer) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }

function files(root: string, directory: string, include: (path: string) => boolean): DevelopmentFile[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const absolute = resolve(directory, entry.name);
		// These are never part of the runtime closure, including managed overlay links.
		if (entry.name === '.treeseed' || entry.name === 'node_modules' || entry.name === '.git') return [];
		if (entry.isSymbolicLink()) throw new Error(`Host development build contains a symbolic link: ${relative(root, absolute)}.`);
		if (entry.isDirectory()) return files(root, absolute, include);
		if (!entry.isFile()) throw new Error(`Host development build contains an unsupported file: ${relative(root, absolute)}.`);
		if (!include(absolute)) return [];
		const content = readFileSync(absolute);
		return [{ path: relative(root, absolute), size: content.byteLength, sha256: sha256(content) }];
	}).sort((left, right) => left.path.localeCompare(right.path));
}

export function hostDevelopmentRuntimeManifest(worktree: string) {
	// Deployment owns the runtime roots; preserve their installed resolution graph.
	const roots = [resolve(worktree, 'dist'), ...hostDependencyRoots(worktree)];
	for (const root of roots) if (!existsSync(root)) throw new Error(`Host development runtime dependency is missing: ${relative(worktree, root)}.`);
	const packageContent = readFileSync(resolve(worktree, 'package.json'));
	const declaredAssets: unknown = JSON.parse(packageContent.toString('utf8')).treeseed?.hostRuntimeAssets ?? [];
	if (!Array.isArray(declaredAssets) || declaredAssets.some((path: unknown) => typeof path !== 'string'
		|| !/^node_modules\/(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+\/(?:[a-zA-Z0-9@._+-]+\/)*[a-zA-Z0-9@._+-]+$/u.test(path)
		|| path.split('/').some(segment => segment === '.' || segment === '..')))
		throw new Error('Deployment hostRuntimeAssets must contain exact production dependency file paths.');
	const assets = new Set<string>(declaredAssets);
	const productionRuntimeFile = (path: string) => {
		return /\.(?:[cm]?js|json|node|wasm)$/u.test(path) || assets.has(relative(worktree, path));
	};
	const manifest = [{ path: 'package.json', size: packageContent.byteLength, sha256: sha256(packageContent) }, ...roots.flatMap((root) => files(worktree, root, productionRuntimeFile))].sort((left, right) => left.path.localeCompare(right.path));
	for (const asset of assets) if (!manifest.some(file => file.path === asset))
		throw new Error(`Declared host runtime asset is missing from the production dependency closure: ${asset}.`);
	return manifest;
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
	const json = invocation.options.json === true;
	if (invocation.command.name === 'dev host status') return invoke(context, 'local.dev.host.status', {});
	if (invocation.command.name === 'dev host deactivate') return invocation.options.plan === true ? { action: 'deactivate', mutation: false } : invoke(context, 'local.dev.host.deactivate', {});
	if (invocation.command.name === 'dev host guest image import') {
		const image = String(invocation.arguments[0] ?? '');
		if (!/^(?:docker\.io\/)?treeseed\/sandbox-[a-z0-9._-]+:local$/u.test(image)) throw new Error('Development guest image must use a treeseed/sandbox-*:local reference.');
		if (invocation.options.plan === true) return { action: 'guest-image-import', image, mutation: false };
		const stateBase = context.env.XDG_STATE_HOME ?? (context.env.HOME ? resolve(context.env.HOME, '.local', 'state') : null);
		if (!stateBase) throw new Error('HOME or XDG_STATE_HOME is required for development guest-image custody.');
		const directory = resolve(stateBase, 'treeseed', 'development', 'images'), archivePath = resolve(directory, `sandbox-${randomUUID()}.tar`);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		try {
			if (!json) context.write(`Exporting ${image} for the local Kata runtime…`, 'stdout');
			execFileSync('docker', ['image', 'save', '--output', archivePath, image], { cwd: context.cwd, env: context.env, stdio: json ? 'pipe' : 'inherit' });
			const result = await invoke(context, 'local.dev.host.guest-image.import', { archivePath, image }) as { digest?: unknown; architecture?: unknown };
			if (typeof result.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(result.digest)) throw new Error('Host guest-image import omitted its immutable digest.');
			const receipt = resolve(stateBase, 'treeseed', 'development', 'sandbox-guest.json'), temporary = `${receipt}.${process.pid}.tmp`;
			writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 'treeseed.development-sandbox-guest/v1', image, digest: result.digest, architecture: result.architecture, importedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
			renameSync(temporary, receipt);
			return result;
		} finally { rmSync(archivePath, { force: true }); }
	}
	if (invocation.command.name !== 'dev host activate') throw new Error(`Unsupported host development command ${invocation.command.name}.`);
	const worktree = resolve(String(invocation.arguments[0] ?? defaultWorktree(context.cwd)));
	const packagePath = resolve(worktree, 'package.json');
	if (invocation.options.plan === true) return { action: 'activate', worktree, guestImageDigest: invocation.options.guestImage ?? null, mutation: false };
	if (!existsSync(packagePath) || basename(worktree) !== 'deployment') throw new Error('Host development activation requires the Deployment package worktree.');
	if (!json) context.write('Building the local host runtime…', 'stdout');
	execFileSync('npm', ['run', 'build'], { cwd: worktree, env: context.env, stdio: json ? 'pipe' : 'inherit' });
	const manifest = hostDevelopmentRuntimeManifest(worktree);
	if (!manifest.some((entry) => entry.path === 'dist/src/bin/supervisor.js') || !manifest.some((entry) => entry.path === 'dist/src/bin/api.js') || !manifest.some((entry) => entry.path === 'dist/src/bin/sandbox-broker.js')) throw new Error('Host development build is missing a required runtime entrypoint.');
	const source = readFileSync(packagePath);
	const generationId = `dev-${Date.now()}-${randomUUID().slice(0, 8)}`;
	if (!json) context.write(`Activating ${generationId} and checking host services…`, 'stdout');
	await invoke(context, 'local.dev.host.activate', { generationId, worktree, packageSha256: sha256(source), files: manifest, ...(typeof invocation.options.guestImage === 'string' ? { guestImageDigest: invocation.options.guestImage } : {}) });
	return awaitActivation(context, generationId);
}
