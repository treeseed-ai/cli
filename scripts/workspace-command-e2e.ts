#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import yaml from 'yaml';
import { packageScriptPath } from './package-tools.ts';
import { collectCliPreflight, createWranglerCommandEnv, formatCliPreflightReport, writeJsonArtifact } from './workspace-preflight-lib.ts';
import { ensureDeployWorkflow, parseGitHubRepositoryFromRemote } from './github-automation-lib.ts';
import { MERGE_CONFLICT_EXIT_CODE } from './workspace-save-lib.ts';
import { createTempDir, run, workspacePackages, workspaceRoot } from './workspace-tools.ts';

const root = workspaceRoot();
const argv = new Set(process.argv.slice(2));
const mode =
	argv.has('--mode=staging') || argv.has('--staging')
		? 'staging'
		: argv.has('--mode=full') || argv.has('--full')
			? 'full'
			: 'local';
const runLocal = mode === 'local' || mode === 'full';
const runStaging = mode === 'staging' || mode === 'full';
const npmCacheRoot = resolve(
	process.env.TREESEED_RELEASE_NPM_CACHE_DIR
		?? resolve(tmpdir(), 'treeseed-npm-cache'),
);
const artifactsRoot = process.env.TREESEED_E2E_ARTIFACTS_DIR
	? resolve(process.env.TREESEED_E2E_ARTIFACTS_DIR)
	: createTempDir('treeseed-command-e2e-');
mkdirSync(artifactsRoot, { recursive: true });

const report = {
	mode,
	startedAt: new Date().toISOString(),
	artifactsRoot,
	steps: [],
	summary: {
		ok: true,
	},
};

function log(message) {
	console.log(`[treeseed:e2e ${new Date().toISOString()}] ${message}`);
}

function sanitizeFileName(value) {
	return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function shellEscape(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function cacheEnv(extraEnv = {}) {
	return {
		npm_config_cache: npmCacheRoot,
		NPM_CONFIG_CACHE: npmCacheRoot,
		npm_config_prefer_offline: 'true',
		npm_config_audit: 'false',
		npm_config_fund: 'false',
		...extraEnv,
	};
}

function writeCommandArtifact(label, payload) {
	writeJsonArtifact(resolve(artifactsRoot, 'commands', `${sanitizeFileName(label)}.json`), payload);
}

function recordStep(name, data) {
	report.steps.push({
		name,
		...data,
	});
}

async function withStep(name, action) {
	const startedAt = Date.now();
	log(`${name} started`);
	try {
		const result = await action();
		recordStep(name, {
			status: 'completed',
			durationMs: Date.now() - startedAt,
			result,
		});
		log(`${name} completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
		return result;
	} catch (error) {
		report.summary.ok = false;
		recordStep(name, {
			status: 'failed',
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		});
		log(`${name} failed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
		throw error;
	}
}

function writeReport() {
	report.finishedAt = new Date().toISOString();
	writeJsonArtifact(resolve(artifactsRoot, 'report.json'), report);
}

function runCommand(label, command, commandArgs, options = {}) {
	const startedAt = Date.now();
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd ?? root,
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: options.timeoutMs,
	});
	const entry = {
		label,
		command,
		args: commandArgs,
		cwd: options.cwd ?? root,
		status: result.status ?? 1,
		signal: result.signal ?? null,
		durationMs: Date.now() - startedAt,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
	writeCommandArtifact(label, entry);
	const allowedExitCodes = new Set(options.allowedExitCodes ?? [0]);
	if (!allowedExitCodes.has(entry.status)) {
		throw new Error(
			[
				`${label} failed with exit ${entry.status}.`,
				entry.stdout.trim(),
				entry.stderr.trim(),
			].filter(Boolean).join('\n'),
		);
	}
	return entry;
}

function randomPort(base) {
	return base + Math.floor(Math.random() * 500);
}

function waitForRegexOutput(bufferRef, regex, timeoutMs, label) {
	return new Promise((resolvePromise, reject) => {
		const startedAt = Date.now();
		const interval = setInterval(() => {
			if (regex.test(bufferRef.text)) {
				clearInterval(interval);
				resolvePromise({
					durationMs: Date.now() - startedAt,
				});
				return;
			}
			if (Date.now() - startedAt >= timeoutMs) {
				clearInterval(interval);
				reject(new Error(`${label} timed out waiting for ${regex}.`));
			}
		}, 250);
	});
}

function isBindFailureOutput(source) {
	return /listen EPERM|Address already in use|failed: ::bind\(|EADDRINUSE/i.test(source);
}

function portFromArgs(args) {
	const portFlagIndex = args.findIndex((value) => value === '--port');
	if (portFlagIndex >= 0) {
		const candidate = Number(args[portFlagIndex + 1]);
		return Number.isFinite(candidate) ? candidate : null;
	}
	return null;
}

async function waitForLocalDevReady(bufferRef, port, timeoutMs, label, readyPattern, childState) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (readyPattern.test(bufferRef.text)) {
			return;
		}
		if (childState.exited) {
			throw new Error(
				`${label} exited before reaching readiness (exit=${childState.code ?? 'unknown'} signal=${childState.signal ?? 'none'}).\n${bufferRef.text.trim()}`,
			);
		}
		if (port) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}`);
				if (response.ok || response.status === 404) {
					return;
				}
			} catch {
				// Keep polling.
			}
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
	}

	throw new Error(`${label} timed out waiting for dev readiness.`);
}

function runBuildSmoke(label, cwd, extraArgs = []) {
	const commandLine = ['npm', 'run', 'build', '--', ...extraArgs].map(shellEscape).join(' ');
	const result = spawnSync('script', ['-qefc', commandLine, '/dev/null'], {
		cwd,
		env: { ...process.env, ...cacheEnv() },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 1800000,
	});
	const entry = {
		label,
		command: 'script',
		args: ['-qefc', commandLine, '/dev/null'],
		cwd,
		status: result.status ?? 1,
		signal: result.signal ?? null,
		durationMs: 0,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
	writeCommandArtifact(label, entry);
	if (entry.status !== 0) {
		throw new Error(`${label} failed with exit ${entry.status}.\n${entry.stdout}\n${entry.stderr}`.trim());
	}
	return entry;
}

function createManualPackageTarball(pkg) {
	const stageRoot = mkdtempSync(join(tmpdir(), 'treeseed-package-stage-'));
	const packageStageRoot = resolve(stageRoot, 'package');
	mkdirSync(packageStageRoot, { recursive: true });

	for (const entry of ['package.json', 'README.md', ...(pkg.packageJson.files ?? [])]) {
		const sourcePath = resolve(pkg.dir, entry);
		const targetPath = resolve(packageStageRoot, entry);
		cpSync(sourcePath, targetPath, { recursive: true });
	}

	const tarballPath = resolve(tmpdir(), `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.packageJson.version}-e2e.tgz`);
	run('tar', ['-czf', tarballPath, '-C', stageRoot, 'package'], { cwd: root });
	return {
		packageName: pkg.name,
		tarballPath,
		stageRoot,
	};
}

async function runDevSession(label, cwd, {
	args: devArgs = [],
	env = {},
	readyPattern = /ready on|http:\/\/127\.0\.0\.1|http:\/\/localhost|starting unified wrangler watch mode/i,
	rebuildPattern = /rebuild complete|detected \d+ change/i,
	mutate = null,
	timeoutMs = 180000,
} = {}) {
	const port = portFromArgs(devArgs);
	const commandLine = [process.execPath, packageScriptPath('treeseed'), 'dev', ...devArgs].map(shellEscape).join(' ');
	const child = spawn('script', ['-qefc', commandLine, '/dev/null'], {
		cwd,
		env: {
			...process.env,
			...cacheEnv(createWranglerCommandEnv(env)),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const output = { text: '' };
	const childState = { exited: false, code: null, signal: null };
	child.stdout.on('data', (chunk) => {
		output.text += String(chunk);
	});
	child.stderr.on('data', (chunk) => {
		output.text += String(chunk);
	});
	child.on('exit', (code, signal) => {
		childState.exited = true;
		childState.code = code;
		childState.signal = signal;
	});

	const logPath = resolve(artifactsRoot, 'commands', `${sanitizeFileName(label)}.log`);
	mkdirSync(dirname(logPath), { recursive: true });
	let pendingError = null;

	try {
		await waitForLocalDevReady(output, port, timeoutMs, `${label} readiness`, readyPattern, childState);
		if (mutate) {
			await mutate();
			await waitForRegexOutput(output, rebuildPattern, timeoutMs, `${label} rebuild`);
		}
	} catch (error) {
		pendingError = error;
	} finally {
		if (!childState.exited) {
			child.kill('SIGTERM');
			await new Promise((resolvePromise) => child.once('exit', () => resolvePromise()));
		}
		writeFileSync(logPath, output.text, 'utf8');
	}

	if (pendingError && childState.code && isBindFailureOutput(output.text)) {
		if (mutate) {
			await mutate();
			runBuildSmoke(`${label}-fallback-build`, cwd);
		}
		return {
			logPath,
			outputPreview: output.text.slice(-4000),
			degraded: 'bind_failure_fallback',
		};
	}

	if (pendingError) {
		throw pendingError;
	}

	return {
		logPath,
		outputPreview: output.text.slice(-4000),
	};
}

function rewriteScaffoldDependencies(siteRoot, dependencies) {
	const packageJsonPath = resolve(siteRoot, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.dependencies = packageJson.dependencies ?? {};
	for (const [name, specifier] of dependencies.entries()) {
		packageJson.dependencies[name] = specifier;
	}
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

function installManualPackageTarball(siteRoot, packaged) {
	const extractRoot = mkdtempSync(join(tmpdir(), 'treeseed-package-extract-'));
	run('tar', ['-xzf', packaged.tarballPath, '-C', extractRoot], { cwd: root });
	const scopeRoot = resolve(siteRoot, 'node_modules', '@treeseed');
	mkdirSync(scopeRoot, { recursive: true });
	const targetPath = resolve(scopeRoot, packaged.packageName.split('/')[1]);
	cpSync(resolve(extractRoot, 'package'), targetPath, { recursive: true });
	rmSync(extractRoot, { recursive: true, force: true });
}

function scaffoldTenant(siteRoot, dependencies, packagedTarballs) {
	run(process.execPath, [
		packageScriptPath('scaffold-site'),
		siteRoot,
		'--name',
		'Treeseed E2E Site',
		'--site-url',
		'https://staging.treeseed-e2e.example.com',
		'--contact-email',
		'e2e@example.com',
	], { cwd: root });
	rewriteScaffoldDependencies(siteRoot, dependencies);
	for (const packaged of packagedTarballs) {
		installManualPackageTarball(siteRoot, packaged);
	}

	const sharedNodeModules = resolve(root, 'node_modules');
	const sharedLinks = readdirSync(sharedNodeModules, { withFileTypes: true })
		.filter((entry) => entry.name !== '.bin' && entry.name !== '@treeseed')
		.map((entry) => [entry.name, resolve(sharedNodeModules, entry.name)]);
	const copiedSharedPackages = new Set(['astro', '@astrojs']);
	for (const [name, target] of sharedLinks) {
		const targetPath = resolve(siteRoot, 'node_modules', name);
		mkdirSync(dirname(targetPath), { recursive: true });
		if (copiedSharedPackages.has(name)) {
			cpSync(target, targetPath, { recursive: true });
			continue;
		}
		try {
			symlinkSync(target, targetPath, 'dir');
		} catch (error) {
			if (!(error instanceof Error) || !String(error.message).includes('EEXIST')) {
				throw error;
			}
		}
	}
}

function readTenantConfig(tenantRoot) {
	return yaml.parse(readFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), 'utf8'));
}

function appendSaveMarker(filePath, marker) {
	const source = readFileSync(filePath, 'utf8');
	writeFileSync(filePath, `${source.trimEnd()}\n\nTreeseed E2E marker: ${marker}\n`, 'utf8');
}

function writeWorkspaceStub(repoDir) {
	writeFileSync(
		resolve(repoDir, 'package.json'),
		`${JSON.stringify(
			{
				name: 'treeseed-save-stub',
				private: true,
				workspaces: ['packages/*'],
			},
			null,
			2,
		)}\n`,
		'utf8',
	);
}

function cloneLocalWorkspace() {
	const cloneRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-workspace-'));
	run('git', ['clone', '--depth', '1', resolve(root, '..'), cloneRoot], { cwd: root });
	const workingRoot = resolve(cloneRoot, 'docs');
	run('git', ['config', 'user.name', 'Treeseed E2E'], { cwd: cloneRoot });
	run('git', ['config', 'user.email', 'e2e@treeseed.dev'], { cwd: cloneRoot });
	const workflow = ensureDeployWorkflow(workingRoot);
	if (workflow.changed) {
		run('git', ['add', 'docs/.github/workflows/deploy.yml'], { cwd: cloneRoot });
		run('git', ['commit', '-m', 'test: sync deploy workflow for no-op save guard'], { cwd: cloneRoot });
	}
	return {
		cloneRoot,
		workingRoot,
	};
}

function cloneLocalWorkspaceWithBareOrigin() {
	const bareRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-origin-'));
	const cloneRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-workspace-'));
	run('git', ['clone', '--bare', resolve(root, '..'), bareRoot], { cwd: root });
	run('git', ['clone', bareRoot, cloneRoot], { cwd: root });
	const workingRoot = resolve(cloneRoot, 'docs');
	run('git', ['config', 'user.name', 'Treeseed E2E'], { cwd: cloneRoot });
	run('git', ['config', 'user.email', 'e2e@treeseed.dev'], { cwd: cloneRoot });
	return {
		bareRoot,
		cloneRoot,
		workingRoot,
	};
}

function resolveRepositorySlug(repoDir) {
	const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, capture: true }).trim();
	return parseGitHubRepositoryFromRemote(remote);
}

function isProductionLikeTarget(repository, siteUrl) {
	return repository === 'karyon-life/karyon' || /karyon\.life/i.test(siteUrl ?? '');
}

async function waitForGitHubWorkflow(repository, headSha, { timeoutMs = 900000 } = {}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const result = runCommand(
			`gh-run-list-${headSha.slice(0, 7)}`,
			'gh',
			['run', 'list', '--repo', repository, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,url,workflowName,event,displayTitle'],
			{ cwd: root },
		);
		const runs = JSON.parse(result.stdout || '[]');
		const match = runs.find((entry) => entry.headSha === headSha && /deploy/i.test(entry.workflowName ?? ''));
		if (match?.status === 'completed') {
			if (match.conclusion !== 'success') {
				throw new Error(`GitHub workflow ${match.workflowName} for ${headSha} concluded with ${match.conclusion}.`);
			}
			return match;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 10000));
	}

	throw new Error(`Timed out waiting for GitHub deploy workflow for ${headSha}.`);
}

async function waitForUrl(url, { contains = null, timeoutMs = 300000 } = {}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(url);
			const body = await response.text();
			if (response.ok && (!contains || body.includes(contains))) {
				return {
					status: response.status,
					bodyPreview: body.slice(0, 1000),
				};
			}
		} catch {
			// Keep polling until timeout.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
	}

	throw new Error(`Timed out waiting for ${url}${contains ? ` to contain "${contains}"` : ''}.`);
}

function cloneStagingRepository() {
	const gitUrl = process.env.TREESEED_E2E_STAGING_GIT_URL;
	if (!gitUrl) {
		throw new Error('TREESEED_E2E_STAGING_GIT_URL is required for staging E2E runs.');
	}
	const cloneRoot = mkdtempSync(join(tmpdir(), 'treeseed-staging-clone-'));
	run('git', ['clone', '--depth', '1', gitUrl, cloneRoot], { cwd: root });
	const subdir = process.env.TREESEED_E2E_STAGING_WORKING_DIRECTORY?.trim() || 'docs';
	const workingRoot = resolve(cloneRoot, subdir);
	run('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
		cwd: workingRoot,
		env: cacheEnv(),
	});
	run('git', ['config', 'user.name', 'Treeseed E2E'], { cwd: cloneRoot });
	run('git', ['config', 'user.email', 'e2e@treeseed.dev'], { cwd: cloneRoot });
	return {
		cloneRoot,
		workingRoot,
	};
}

async function runLocalSuite() {
	const preflight = collectCliPreflight({ cwd: root, requireAuth: false });
	writeJsonArtifact(resolve(artifactsRoot, 'preflight.local.json'), preflight);
	log(formatCliPreflightReport(preflight));

	await withStep('workspace dev smoke', async () => {
		return await runDevSession('workspace-dev-smoke', root, {
			args: ['--port', String(randomPort(8800))],
		});
	});

	const dependencies = new Map();
	const manualTarballs = [];
	await withStep('local package tarball preparation', async () => {
		for (const packageName of ['@treeseed/sdk', '@treeseed/core']) {
			const pkg = workspacePackages(root).find((entry) => entry.name === packageName);
			if (!pkg) {
				throw new Error(`Unable to find workspace package ${packageName}.`);
			}
			run('npm', ['run', 'build:dist'], { cwd: pkg.dir });
			const packaged = createManualPackageTarball(pkg);
			manualTarballs.push(packaged);
			dependencies.set(packageName, packaged.tarballPath);
		}
		return Object.fromEntries(dependencies);
	});

	const siteRoot = mkdtempSync(join(tmpdir(), 'treeseed-command-e2e-site-'));
	try {
		await withStep('scaffold tenant init', async () => {
			scaffoldTenant(siteRoot, dependencies, manualTarballs);
			return { siteRoot };
		});

		await withStep('scaffold tenant dev watch smoke', async () => {
			const notePath = resolve(siteRoot, 'src', 'content', 'notes', 'first-note.mdx');
			return await runDevSession('scaffold-dev-watch', siteRoot, {
				args: ['--watch', '--port', String(randomPort(9300))],
				mutate: async () => {
					appendSaveMarker(notePath, 'treeseed-e2e-local-watch');
				},
			});
		});

		await withStep('scaffold tenant build', async () => {
			return runCommand('scaffold-build', process.execPath, [packageScriptPath('treeseed'), 'build'], {
				cwd: siteRoot,
				env: cacheEnv(),
			});
		});

		await withStep('scaffold tenant deploy dry-run', async () => {
			return runCommand('scaffold-deploy-dry-run', process.execPath, [packageScriptPath('treeseed'), 'deploy', '--dry-run'], {
				cwd: siteRoot,
				env: cacheEnv(),
			});
		});

		await withStep('scaffold tenant destroy dry-run', async () => {
			const deployConfig = readTenantConfig(siteRoot);
			return runCommand('scaffold-destroy-dry-run', process.execPath, [packageScriptPath('treeseed'), 'destroy', '--dry-run', '--skip-confirmation', '--confirm', String(deployConfig.slug)], {
				cwd: siteRoot,
				env: cacheEnv(),
			});
		});
	} finally {
		rmSync(siteRoot, { recursive: true, force: true });
		for (const packaged of manualTarballs) {
			rmSync(packaged.tarballPath, { force: true });
			rmSync(packaged.stageRoot, { recursive: true, force: true });
		}
	}

	await withStep('save guard: missing message', async () => {
		return runCommand('save-missing-message', process.execPath, [packageScriptPath('treeseed'), 'save'], {
			cwd: root,
			allowedExitCodes: [1],
		});
	});

	await withStep('save guard: wrong branch', async () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'treeseed-save-branch-'));
		try {
			run('git', ['init', '--initial-branch=feature/e2e'], { cwd: repoDir });
			writeWorkspaceStub(repoDir);
			return runCommand('save-wrong-branch', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: wrong branch'], {
				cwd: repoDir,
				allowedExitCodes: [1],
			});
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	await withStep('save guard: missing origin', async () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'treeseed-save-origin-'));
		try {
			run('git', ['init', '--initial-branch=main'], { cwd: repoDir });
			writeWorkspaceStub(repoDir);
			return runCommand('save-missing-origin', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: missing origin'], {
				cwd: repoDir,
				allowedExitCodes: [1],
			});
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	await withStep('save guard: no changes', async () => {
		const clonedWorkspace = cloneLocalWorkspace();
		try {
			return runCommand('save-no-changes', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: no-op save'], {
				cwd: clonedWorkspace.workingRoot,
				allowedExitCodes: [1],
				env: cacheEnv(),
			});
		} finally {
			rmSync(clonedWorkspace.cloneRoot, { recursive: true, force: true });
		}
	});

	await withStep('save success: local bare origin with stubbed automation', async () => {
		const clonedWorkspace = cloneLocalWorkspaceWithBareOrigin();
		try {
			const notePath = resolve(clonedWorkspace.workingRoot, 'src/content/notes/first-note.mdx');
			appendSaveMarker(notePath, 'treeseed-e2e-local-save-success');
			const saveReportPath = resolve(artifactsRoot, 'save-local-success.json');
			const result = runCommand('save-local-success', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: local save success'], {
				cwd: clonedWorkspace.workingRoot,
				env: {
					...cacheEnv(),
					TREESEED_GITHUB_AUTOMATION_MODE: 'stub',
					TREESEED_SAVE_REPORT_PATH: saveReportPath,
				},
				timeoutMs: 1800000,
			});
			const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: clonedWorkspace.cloneRoot, capture: true }).trim();
			const remoteHead = run('git', ['--git-dir', clonedWorkspace.bareRoot, 'rev-parse', 'refs/heads/main'], { cwd: root, capture: true }).trim();
			if (localHead !== remoteHead) {
				throw new Error(`Expected pushed head ${remoteHead} to match local head ${localHead}.`);
			}
			return {
				...result,
				saveReportPath,
				localHead,
				remoteHead,
			};
		} finally {
			rmSync(clonedWorkspace.cloneRoot, { recursive: true, force: true });
			rmSync(clonedWorkspace.bareRoot, { recursive: true, force: true });
		}
	});
}

async function runStagingSuite() {
	const preflight = collectCliPreflight({ cwd: root, requireAuth: true });
	writeJsonArtifact(resolve(artifactsRoot, 'preflight.staging.json'), preflight);
	log(formatCliPreflightReport(preflight));
	if (!preflight.ok) {
		throw new Error('Staging preflight failed.');
	}

	const staging = cloneStagingRepository();
	try {
		const repository = resolveRepositorySlug(staging.cloneRoot);
		const deployConfig = readTenantConfig(staging.workingRoot);
		if (!process.env.TREESEED_E2E_ALLOW_PRODUCTION && isProductionLikeTarget(repository, deployConfig.siteUrl)) {
			throw new Error(`Refusing to run staging E2E against production-like target ${repository} / ${deployConfig.siteUrl}.`);
		}

		await withStep('staging deploy', async () => {
			return runCommand('staging-deploy', 'npm', ['run', 'deploy', '--', '--name', 'treeseed-e2e-staging'], {
				cwd: staging.workingRoot,
				env: cacheEnv(createWranglerCommandEnv()),
				timeoutMs: 900000,
			});
		});

		await withStep('staging site reachability', async () => {
			return await waitForUrl(deployConfig.siteUrl);
		});

		const notePath = resolve(staging.workingRoot, process.env.TREESEED_E2E_SAVE_FILE ?? 'src/content/notes/first-note.mdx');
		for (const iteration of [1, 2]) {
			await withStep(`staging save iteration ${iteration}`, async () => {
				const marker = `treeseed-e2e-save-${iteration}`;
				appendSaveMarker(notePath, marker);
				const saveReportPath = resolve(artifactsRoot, `save-iteration-${iteration}.json`);
				runCommand(`staging-save-${iteration}`, 'npm', ['run', 'save', '--', `test: treeseed e2e save iteration ${iteration}`], {
					cwd: staging.workingRoot,
					env: {
						...cacheEnv(createWranglerCommandEnv()),
						TREESEED_SAVE_REPORT_PATH: saveReportPath,
					},
					timeoutMs: 1800000,
				});
				const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: staging.cloneRoot, capture: true }).trim();
				const workflow = await waitForGitHubWorkflow(repository, headSha);
				const siteCheck = await waitForUrl(deployConfig.siteUrl, { contains: marker, timeoutMs: 600000 });
				return {
					headSha,
					workflow,
					siteCheck,
					saveReportPath,
				};
			});
		}

		await withStep('staging save no-op guard', async () => {
			return runCommand('staging-save-no-op', 'npm', ['run', 'save', '--', 'test: staging no-op save'], {
				cwd: staging.workingRoot,
				env: cacheEnv(createWranglerCommandEnv()),
				allowedExitCodes: [1],
				timeoutMs: 180000,
			});
		});

		await withStep('staging merge-conflict reporting', async () => {
			const local = cloneStagingRepository();
			const remote = cloneStagingRepository();
			const relativeSaveFile = process.env.TREESEED_E2E_SAVE_FILE ?? 'src/content/notes/first-note.mdx';
			try {
				appendSaveMarker(resolve(remote.workingRoot, relativeSaveFile), 'treeseed-e2e-remote-conflict');
				run('git', ['add', '.'], { cwd: remote.cloneRoot });
				run('git', ['commit', '-m', 'test: remote conflict seed'], { cwd: remote.cloneRoot });
				run('git', ['push', 'origin', 'main'], { cwd: remote.cloneRoot });

				appendSaveMarker(resolve(local.workingRoot, relativeSaveFile), 'treeseed-e2e-local-conflict');
				const saveReportPath = resolve(artifactsRoot, 'save-conflict.json');
				const result = runCommand('staging-save-conflict', 'npm', ['run', 'save', '--', 'test: staging merge conflict'], {
					cwd: local.workingRoot,
					env: {
						...cacheEnv(createWranglerCommandEnv()),
						TREESEED_SAVE_REPORT_PATH: saveReportPath,
					},
					allowedExitCodes: [MERGE_CONFLICT_EXIT_CODE],
					timeoutMs: 1800000,
				});
				return {
					exitCode: result.status,
					saveReportPath,
				};
			} finally {
				try {
					run('git', ['rebase', '--abort'], { cwd: local.cloneRoot, capture: true });
				} catch {
					// Best effort cleanup for the temporary clone.
				}
				rmSync(local.cloneRoot, { recursive: true, force: true });
				rmSync(remote.cloneRoot, { recursive: true, force: true });
			}
		});

		await withStep('staging destroy', async () => {
			return runCommand('staging-destroy', 'npm', ['run', 'destroy', '--', '--force', '--skip-confirmation', '--confirm', String(deployConfig.slug), '--remove-build-artifacts'], {
				cwd: staging.workingRoot,
				env: cacheEnv(createWranglerCommandEnv()),
				timeoutMs: 900000,
			});
		});
	} finally {
		rmSync(staging.cloneRoot, { recursive: true, force: true });
	}
}

(async () => {
	try {
		if (runLocal) {
			await runLocalSuite();
		}
		if (runStaging) {
			await runStagingSuite();
		}
		report.summary.ok = true;
		writeReport();
		console.log(`Treeseed command E2E completed successfully. Artifacts: ${artifactsRoot}`);
	} catch (error) {
		report.summary.ok = false;
		report.summary.error = error instanceof Error ? error.message : String(error);
		writeReport();
		console.error(report.summary.error);
		console.error(`Treeseed command E2E artifacts: ${artifactsRoot}`);
		process.exit(1);
	}
})();
