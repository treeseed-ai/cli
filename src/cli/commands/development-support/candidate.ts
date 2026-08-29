import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { developmentStateRoot } from '../development-cli-selection.js';

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
