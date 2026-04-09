#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentPackageRoot, corePackageRoot, packageRoot, packageScriptPath, sdkPackageRoot } from './package-tools.ts';
import { listTemplateProducts, validateTemplateProduct } from './template-registry-lib.ts';

const npmCacheDir = process.env.TREESEED_SCAFFOLD_NPM_CACHE_DIR
	? resolve(process.env.TREESEED_SCAFFOLD_NPM_CACHE_DIR)
	: resolve(tmpdir(), 'treeseed-npm-cache');
const packageJson = JSON.parse(readFileSync(resolve(corePackageRoot, 'package.json'), 'utf8'));
const sdkPackageJson = JSON.parse(readFileSync(resolve(sdkPackageRoot, 'package.json'), 'utf8'));
const cliPackageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
const agentPackageJson = JSON.parse(readFileSync(resolve(agentPackageRoot, 'package.json'), 'utf8'));
const workspaceTarballs = (() => {
	try {
		return JSON.parse(process.env.TREESEED_WORKSPACE_TARBALLS ?? '{}');
	} catch {
		return {};
	}
})();
const externalCoreTarball = process.env.TREESEED_SCAFFOLD_CORE_TARBALL
	? resolve(process.env.TREESEED_SCAFFOLD_CORE_TARBALL)
	: typeof workspaceTarballs['@treeseed/core'] === 'string'
		? resolve(workspaceTarballs['@treeseed/core'])
	: null;
const externalSdkTarball = process.env.TREESEED_SCAFFOLD_SDK_TARBALL
	? resolve(process.env.TREESEED_SCAFFOLD_SDK_TARBALL)
	: typeof workspaceTarballs['@treeseed/sdk'] === 'string'
		? resolve(workspaceTarballs['@treeseed/sdk'])
	: null;
const externalCliTarball = process.env.TREESEED_SCAFFOLD_CLI_TARBALL
	? resolve(process.env.TREESEED_SCAFFOLD_CLI_TARBALL)
	: typeof workspaceTarballs['@treeseed/cli'] === 'string'
		? resolve(workspaceTarballs['@treeseed/cli'])
	: null;
const externalAgentTarball = process.env.TREESEED_SCAFFOLD_AGENT_TARBALL
	? resolve(process.env.TREESEED_SCAFFOLD_AGENT_TARBALL)
	: typeof workspaceTarballs['@treeseed/agent'] === 'string'
		? resolve(workspaceTarballs['@treeseed/agent'])
	: null;
const reusesExternalTarballs = Boolean(externalCoreTarball || externalSdkTarball || externalCliTarball || externalAgentTarball);
const scaffoldChecks = new Set(
	(process.env.TREESEED_SCAFFOLD_CHECKS ?? 'build,deploy')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean),
);
const timings = [];
const resetScaffoldCache = process.env.TREESEED_SCAFFOLD_RESET_CACHE === '1';
const scaffoldTempRoot = resolve(process.env.TREESEED_SCAFFOLD_TEMP_ROOT ?? resolve(packageRoot, '.local', 'tmp'));
mkdirSync(scaffoldTempRoot, { recursive: true });

function logStep(message) {
	console.log(`[treeseed:test-scaffold] ${message}`);
}

function withTiming(label, action) {
	const startedAt = Date.now();
	logStep(`${label} started`);
	try {
		const result = action();
		if (result && typeof result.then === 'function') {
			return result.then((resolved) => {
				const durationMs = Date.now() - startedAt;
				timings.push({ label, durationMs, status: 'completed' });
				logStep(`${label} completed in ${(durationMs / 1000).toFixed(1)}s`);
				return resolved;
			}).catch((error) => {
				const durationMs = Date.now() - startedAt;
				timings.push({ label, durationMs, status: 'failed' });
				logStep(`${label} failed in ${(durationMs / 1000).toFixed(1)}s`);
				throw error;
			});
		}
		const durationMs = Date.now() - startedAt;
		timings.push({ label, durationMs, status: 'completed' });
		logStep(`${label} completed in ${(durationMs / 1000).toFixed(1)}s`);
		return result;
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		timings.push({ label, durationMs, status: 'failed' });
		logStep(`${label} failed in ${(durationMs / 1000).toFixed(1)}s`);
		throw error;
	}
}

function printSummary() {
	if (timings.length === 0) {
		return;
	}

	console.log('[treeseed:test-scaffold] Stage summary');
	for (const entry of timings) {
		console.log(
			`[treeseed:test-scaffold] ${entry.status === 'completed' ? 'ok  ' : 'fail'} ${entry.label} (${(entry.durationMs / 1000).toFixed(1)}s)`,
		);
	}
}

function resetNpmCache() {
	rmSync(npmCacheDir, { recursive: true, force: true });
}

function runStep(command, args, { cwd = packageRoot, env = {}, capture = false } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: { ...process.env, ...env },
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		const message = capture ? (result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`) : `${command} ${args.join(' ')} failed`;
		throw new Error(message);
	}

	return result;
}

function createTempSiteRoot() {
	return mkdtempSync(join(scaffoldTempRoot, 'treeseed-scaffold-'));
}

function rewriteScaffoldDependency(siteRoot, tarballPath, cliTarballPath) {
	const packageJsonPath = resolve(siteRoot, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.dependencies = packageJson.dependencies ?? {};
	packageJson.dependencies['@treeseed/core'] = tarballPath;
	packageJson.dependencies['@treeseed/cli'] = cliTarballPath;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

function installManualPackageTarball(siteRoot, tarballPath, packageName) {
	const extractRoot = mkdtempSync(join(scaffoldTempRoot, 'treeseed-scaffold-package-'));
	try {
		runStep('tar', ['-xzf', tarballPath, '-C', extractRoot]);
		const scopeRoot = resolve(siteRoot, 'node_modules', '@treeseed');
		mkdirSync(scopeRoot, { recursive: true });
		cpSync(resolve(extractRoot, 'package'), resolve(scopeRoot, packageName.split('/')[1]), { recursive: true });
	} finally {
		rmSync(extractRoot, { recursive: true, force: true });
	}
}

function linkWorkspacePackage(siteRoot, packageName, sourceRoot) {
	const scopeRoot = resolve(siteRoot, 'node_modules', '@treeseed');
	mkdirSync(scopeRoot, { recursive: true });
	symlinkSync(sourceRoot, resolve(scopeRoot, packageName.split('/')[1]), 'dir');
}

function resolveSharedNodeModulesRoot() {
	let current = packageRoot;
	while (true) {
		const candidate = resolve(current, 'node_modules');
		if (existsSync(candidate)) {
			return candidate;
		}

		const parent = resolve(current, '..');
		if (parent === current) {
			break;
		}
		current = parent;
	}

	throw new Error(`Unable to locate a shared node_modules directory for ${packageRoot}.`);
}

function mirrorSharedNodeModules(siteRoot) {
	const sharedNodeModules = resolveSharedNodeModulesRoot();
	for (const entry of readdirSync(sharedNodeModules, { withFileTypes: true })) {
		if (entry.name === '.bin' || entry.name === '@treeseed' || entry.name === '@astrojs') {
			continue;
		}
		const sourcePath = resolve(sharedNodeModules, entry.name);
		const targetPath = resolve(siteRoot, 'node_modules', entry.name);
		mkdirSync(dirname(targetPath), { recursive: true });
		if (entry.name === 'astro') {
			cpSync(sourcePath, targetPath, { recursive: true });
			continue;
		}
		symlinkSync(sourcePath, targetPath, 'dir');
	}

	const sharedAstroScope = resolve(sharedNodeModules, '@astrojs');
	const targetAstroScope = resolve(siteRoot, 'node_modules', '@astrojs');
	mkdirSync(targetAstroScope, { recursive: true });
	for (const packageName of ['cloudflare', 'mdx', 'sitemap', 'starlight']) {
		cpSync(resolve(sharedAstroScope, packageName), resolve(targetAstroScope, packageName), { recursive: true });
	}
}

function linkTreeseedBins(siteRoot) {
	const binRoot = resolve(siteRoot, 'node_modules', '.bin');
	mkdirSync(binRoot, { recursive: true });
	for (const [name, relativeTarget] of [
		['treeseed', '../@treeseed/cli/dist/cli/main.js'],
		['treeseed-agents', '../@treeseed/agent/dist/scripts/treeseed-agents.js'],
	]) {
		symlinkSync(relativeTarget, resolve(binRoot, name));
	}
}

function createTarball(root, pkg) {
	return withTiming(`${pkg.name} build+pack`, () => {
		if (typeof pkg.scripts?.['build:dist'] === 'string') {
			runStep('npm', ['run', 'build:dist'], { cwd: root });
		}
		const output = runStep('npm', ['pack', '--silent', '--ignore-scripts', '--cache', npmCacheDir], {
			cwd: root,
			capture: true,
			env: {
				npm_config_cache: npmCacheDir,
				NPM_CONFIG_CACHE: npmCacheDir,
			},
		});
		const filename = output.stdout
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.at(-1)
			|| `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
		return resolve(root, filename);
	});
}

async function scaffoldSite(siteRoot) {
	for (const definition of await listTemplateProducts({ writeWarning: (message) => console.warn(message) })) {
		await validateTemplateProduct(definition, { writeWarning: (message) => console.warn(message) });
	}
	runStep(process.execPath, [packageScriptPath('scaffold-site'), siteRoot, '--template', 'starter-basic', '--name', 'Smoke Site', '--site-url', 'https://smoke.example.com', '--contact-email', 'hello@example.com']);
}

function installScaffold(siteRoot, { coreTarballPath, sdkTarballPath, cliTarballPath, agentTarballPath }) {
	if (coreTarballPath && sdkTarballPath && cliTarballPath && agentTarballPath) {
		linkWorkspacePackage(siteRoot, sdkPackageJson.name, sdkPackageRoot);
		linkWorkspacePackage(siteRoot, packageJson.name, corePackageRoot);
		linkWorkspacePackage(siteRoot, cliPackageJson.name, packageRoot);
		linkWorkspacePackage(siteRoot, agentPackageJson.name, agentPackageRoot);
		mirrorSharedNodeModules(siteRoot);
		linkTreeseedBins(siteRoot);
		return;
	}

	runStep('npm', ['install', '--cache', npmCacheDir, '--prefer-offline', '--no-audit', '--no-fund'], {
		cwd: siteRoot,
		env: {
			npm_config_cache: npmCacheDir,
			NPM_CONFIG_CACHE: npmCacheDir,
			npm_config_prefer_offline: 'true',
			npm_config_audit: 'false',
			npm_config_fund: 'false',
		},
	});
}

function runScaffoldChecks(siteRoot) {
	if (scaffoldChecks.has('build')) {
		withTiming('scaffold build', () => {
			runStep('npm', ['run', 'build'], { cwd: siteRoot });
		});
	}
	if (scaffoldChecks.has('deploy')) {
		withTiming('scaffold deploy dry-run', () => {
			runStep('npm', ['run', 'deploy', '--', '--dry-run'], { cwd: siteRoot });
		});
	}
}

const siteRoot = createTempSiteRoot();
let tarballPath = externalCoreTarball;
let sdkTarballPath = externalSdkTarball;
let cliTarballPath = externalCliTarball;
let agentTarballPath = externalAgentTarball;

try {
	if (!reusesExternalTarballs && resetScaffoldCache) {
		logStep(`resetting npm cache at ${npmCacheDir}`);
		resetNpmCache();
	}
	if (!sdkTarballPath) {
		logStep('building and packing @treeseed/sdk');
		sdkTarballPath = createTarball(sdkPackageRoot, sdkPackageJson);
	} else {
		logStep(`reusing provided @treeseed/sdk tarball: ${sdkTarballPath}`);
	}
	if (!tarballPath) {
		logStep('building and packing @treeseed/core');
		tarballPath = createTarball(corePackageRoot, packageJson);
	} else {
		logStep(`reusing provided @treeseed/core tarball: ${tarballPath}`);
	}
	if (!agentTarballPath) {
		logStep('building and packing @treeseed/agent');
		agentTarballPath = createTarball(agentPackageRoot, agentPackageJson);
	} else {
		logStep(`reusing provided @treeseed/agent tarball: ${agentTarballPath}`);
	}
	if (!cliTarballPath) {
		logStep('building and packing @treeseed/cli');
		cliTarballPath = createTarball(packageRoot, cliPackageJson);
	} else {
		logStep(`reusing provided @treeseed/cli tarball: ${cliTarballPath}`);
	}
	logStep(`scaffolding temporary tenant at ${siteRoot}`);
	await withTiming('scaffold tenant generation', async () => {
		await scaffoldSite(siteRoot);
	});
	rewriteScaffoldDependency(siteRoot, tarballPath, cliTarballPath);
	logStep(`installing scaffolded tenant dependencies with checks: ${[...scaffoldChecks].join(', ') || 'none'}`);
	await withTiming('scaffold dependency install', async () => {
		installScaffold(siteRoot, {
			coreTarballPath: tarballPath,
			sdkTarballPath,
			cliTarballPath,
			agentTarballPath,
		});
	});
	logStep('running scaffold smoke checks');
	runScaffoldChecks(siteRoot);
	console.log(`Scaffold smoke test passed in ${dirname(siteRoot) ? siteRoot : '.'}`);
} finally {
	printSummary();
	rmSync(siteRoot, { recursive: true, force: true });
	if (sdkTarballPath && !externalSdkTarball) {
		rmSync(sdkTarballPath, { force: true });
	}
	if (tarballPath && !externalCoreTarball) {
		rmSync(tarballPath, { force: true });
	}
	if (!reusesExternalTarballs && resetScaffoldCache) {
		resetNpmCache();
	}
}
