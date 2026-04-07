import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const packageCandidate = resolve(scriptRoot, '..');

export const packageRoot = packageCandidate.endsWith('/dist')
	? resolve(packageCandidate, '..')
	: packageCandidate;
export const packageScriptRoot = packageCandidate.endsWith('/dist')
	? resolve(packageCandidate, 'scripts')
	: resolve(packageRoot, 'scripts');

function resolvePackageBinary(packageName, binName = packageName) {
	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	const binField = packageJson.bin;
	const relativePath = typeof binField === 'string' ? binField : binField?.[binName];

	if (!relativePath) {
		throw new Error(`Unable to resolve binary "${binName}" from package "${packageName}".`);
	}

	return resolve(dirname(packageJsonPath), relativePath);
}

function resolveTreeseedPackageRoot(packageName, exportPath?: string, fallbackDirName?: string) {
	try {
		const resolvedEntry = require.resolve(exportPath ?? packageName);
		return resolve(dirname(resolvedEntry), '..');
	} catch {
		if (!fallbackDirName) {
			throw new Error(`Unable to resolve package root for "${packageName}".`);
		}
		return resolve(packageRoot, '..', fallbackDirName);
	}
}

export const astroBin = resolvePackageBinary('astro', 'astro');
export const wranglerBin = resolvePackageBinary('wrangler', 'wrangler');
export const corePackageRoot = resolveTreeseedPackageRoot('@treeseed/core', '@treeseed/core/config', 'core');
export const sdkPackageRoot = resolveTreeseedPackageRoot('@treeseed/sdk', '@treeseed/sdk', 'sdk');
export const agentPackageRoot = resolveTreeseedPackageRoot('@treeseed/agent', '@treeseed/agent', 'agent');

export function loadPackageJson(root = process.cwd()) {
	const packageJsonPath = resolve(root, 'package.json');
	if (!existsSync(packageJsonPath)) {
		return null;
	}
	return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

export function isWorkspaceRoot(root = process.cwd()) {
	const packageJson = loadPackageJson(root);
	const workspaces = Array.isArray(packageJson?.workspaces)
		? packageJson.workspaces
		: Array.isArray(packageJson?.workspaces?.packages)
			? packageJson.workspaces.packages
			: [];
	return workspaces.length > 0;
}

export function createProductionBuildEnv(extraEnv = {}) {
	return {
		TREESEED_LOCAL_DEV_MODE: 'cloudflare',
		TREESEED_PUBLIC_FORMS_LOCAL_BYPASS_TURNSTILE: '',
		TREESEED_FORMS_LOCAL_BYPASS_TURNSTILE: '',
		TREESEED_FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS: '',
		TREESEED_PUBLIC_DEV_WATCH_RELOAD: '',
		...extraEnv,
	};
}

export function packageScriptPath(scriptName) {
	if (extname(scriptName)) {
		return resolve(packageScriptRoot, scriptName);
	}

	for (const extension of ['.js', '.ts', '.ts']) {
		const candidate = resolve(packageScriptRoot, `${scriptName}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Unable to resolve package script "${scriptName}".`);
}

export function runNodeBinary(binPath, args, options = {}) {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

export function runNodeScript(scriptPath, args = [], options = {}) {
	return runNodeBinary(scriptPath, args, options);
}

export function spawnNodeBinary(binPath, args, options = {}) {
	return spawn(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
		detached: options.detached ?? false,
	});
}
