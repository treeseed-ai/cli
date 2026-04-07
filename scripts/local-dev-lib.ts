import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { runLocalD1Migrations as applyLocalD1Migrations } from './d1-migration-lib.ts';
import {
	fixtureMigrationsRoot,
	fixtureRoot,
	fixtureWranglerConfig,
	corePackageRoot,
} from './paths.ts';

function mergeEnv(extraEnv = {}) {
	return { ...process.env, ...extraEnv };
}

export function runStep(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: mergeEnv(options.env),
		cwd: options.cwd ?? process.cwd(),
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

export function runNodeScript(scriptRelativePath, args = [], options = {}) {
	return runStep(process.execPath, [resolve(corePackageRoot, scriptRelativePath), ...args], {
		...options,
		cwd: options.cwd ?? corePackageRoot,
	});
}

export function spawnProcess(command, args, options = {}) {
	return spawn(command, args, {
		stdio: options.stdio ?? 'inherit',
		shell: process.platform === 'win32',
		env: mergeEnv(options.env),
		cwd: options.cwd ?? process.cwd(),
		detached: options.detached ?? false,
	});
}

export function syncDevVars(overrides = {}) {
	const overrideEntries = Object.entries(overrides);
	runNodeScript(
		'./scripts/sync-dev-vars.ts',
		overrideEntries.map(([key, value]) => `${key}=${value}`),
		{ cwd: fixtureRoot },
	);
}

export function runLocalD1Migration(persistTo) {
	applyLocalD1Migrations({
		cwd: fixtureRoot,
		wranglerConfig: fixtureWranglerConfig,
		migrationsRoot: fixtureMigrationsRoot,
		persistTo,
	});
}

export function prepareCloudflareLocalRuntime({ envOverrides = {}, persistTo, outDir } = {}) {
	const mergedEnvOverrides = {
		TREESEED_MAILPIT_SMTP_HOST: '127.0.0.1',
		TREESEED_MAILPIT_SMTP_PORT: '1025',
		...envOverrides,
	};

	runNodeScript('./scripts/patch-starlight-content-path.ts');
	runNodeScript('./scripts/aggregate-book.ts');
	runNodeScript('./scripts/ensure-mailpit.ts');
	syncDevVars({
		TREESEED_LOCAL_DEV_MODE: 'cloudflare',
		...mergedEnvOverrides,
	});
	runLocalD1Migration(persistTo);
	const astroArgs = ['astro', 'build', '--root', fixtureRoot];
	if (outDir) {
		astroArgs.push('--outDir', outDir);
	}

	runStep('npx', astroArgs, {
		env: {
			TREESEED_LOCAL_DEV_MODE: 'cloudflare',
			...mergedEnvOverrides,
		},
		cwd: corePackageRoot,
	});

	runNodeScript('./scripts/build-tenant-worker.ts', [], {
		cwd: fixtureRoot,
		env: {
			TREESEED_LOCAL_DEV_MODE: 'cloudflare',
			...mergedEnvOverrides,
		},
	});
}

export function startWranglerDev(args = [], options = {}) {
	return spawnProcess(
		'wrangler',
		['dev', '--local', '--config', fixtureWranglerConfig, ...args],
		{
			...options,
			cwd: options.cwd ?? fixtureRoot,
		},
	);
}
