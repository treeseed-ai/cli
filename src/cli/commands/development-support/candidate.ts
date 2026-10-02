import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { DevelopmentRuntime } from '@treeseed/sdk/development';
import { developmentStateRoot } from '../development-cli-selection.js';

export function repositoryClosure(runtime: DevelopmentRuntime, worktree: string, excludedPaths: string[] = []) {
	const git = (args: string[]) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
	const pathspec = excludedPaths.length ? ['--', '.', ...excludedPaths.map(path => `:(exclude,literal)${path}`)] : [];
	const status = git(['status', '--porcelain=v1', '--untracked-files=all', ...pathspec]);
	const digest = createHash('sha256').update(`${status}\n${git(['diff', '--binary', 'HEAD', ...pathspec])}`);
	// Git diff omits untracked bytes. NUL-delimited native discovery also preserves
	// filenames containing whitespace/newlines, without parsing porcelain quoting.
	for (const name of git(['ls-files', '--others', '--exclude-standard', '-z', ...pathspec]).split('\0').filter(Boolean)) {
		const path = resolve(worktree, name), metadata = lstatSync(path);
		let bytes: Buffer, mode: number;
		if (metadata.isSymbolicLink()) { bytes = Buffer.from(readlinkSync(path)); mode = 0o120000; }
		else {
			const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
			try {
				const opened = fstatSync(descriptor);
				if (!opened.isFile()) throw new Error('Development source requires readable regular files or Git symbolic links.');
				bytes = readFileSync(descriptor); mode = opened.mode & 0o111 ? 0o100755 : 0o100644;
			} finally { closeSync(descriptor); }
		}
		digest.update(JSON.stringify([name, mode, bytes.length])).update('\0').update(bytes);
	}
	return { projectId: runtime.project.id, repository: runtime.project.repository, worktree,
		commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']) || null, dirty: Boolean(status),
		dirtyDigest: status ? `sha256:${digest.digest('hex')}` : null,
		recipeDigest: `sha256:${createHash('sha256').update(JSON.stringify(runtime)).digest('hex')}` };
}

export function artifactPaths(pattern: string, root: string) {
	if (!pattern.includes('*')) return [resolve(root, pattern)];
	const directory = resolve(root, dirname(pattern)), expression = new RegExp(`^${basename(pattern).replaceAll('.', '\\.').replaceAll('*', '.*')}$`, 'u');
	return readdirSync(directory).filter((name) => expression.test(name)).map((name) => resolve(directory, name));
}

export function compatibilityAttestations(repositories: Array<{ worktree: string }>) {
	return repositories.flatMap(({ worktree }) => {
		const path = resolve(worktree, '.treeseed/standards/compatibility-attestation.json');
		if (!existsSync(path)) return [];
		const bytes = readFileSync(path), value = JSON.parse(bytes.toString('utf8')) as { contractId?: unknown; result?: { sufficient?: unknown; required?: unknown } };
		if (typeof value.contractId !== 'string' || value.result?.sufficient !== true || !['none', 'patch', 'minor', 'major'].includes(String(value.result?.required))) throw new Error(`Compatibility attestation is invalid or insufficient: ${path}.`);
		return [{ contractId: value.contractId, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, compatible: true, minimumBump: value.result.required as 'none' | 'patch' | 'minor' | 'major' }];
	});
}

export function withFreezeLock<T>(env: NodeJS.ProcessEnv, sessionId: string, action: () => Promise<T>) {
	const lock = resolve(developmentStateRoot(env), sessionId, 'freeze.lock');
	mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
	let descriptor: number;
	try { descriptor = openSync(lock, 'wx', 0o600); } catch { throw new Error(`Candidate freeze is already active for ${sessionId}.`); }
	return action().finally(() => { closeSync(descriptor); rmSync(lock, { force: true }); });
}
