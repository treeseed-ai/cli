import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function developmentStateRoot(env: NodeJS.ProcessEnv) {
	const base = env.XDG_STATE_HOME ?? (env.HOME ? resolve(env.HOME, '.local', 'state') : null);
	if (!base) throw new Error('HOME or XDG_STATE_HOME is required for development-session custody.');
	return resolve(base, 'treeseed', 'development');
}

export function developmentCliEntrypointPath(env: NodeJS.ProcessEnv) {
	return resolve(developmentStateRoot(env), 'cli-entrypoint');
}

export function selectDevelopmentCli(env: NodeJS.ProcessEnv, selection: { entrypoint: string; expiresAt: string } | null) {
	const path = developmentCliEntrypointPath(env);
	if (selection === null) { rmSync(path, { force: true }); return; }
	const resolved = resolve(selection.entrypoint), expiresAt = Math.floor(new Date(selection.expiresAt).getTime() / 1_000);
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) throw new Error('Development CLI selection requires a future session expiry.');
	if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`Development CLI entrypoint is unavailable: ${resolved}.`);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.new`;
	writeFileSync(temporary, `treeseed.development-cli-selection/v1\n${expiresAt}\n${resolved}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}
