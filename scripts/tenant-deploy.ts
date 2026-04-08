#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyTreeseedEnvironmentToProcess } from './config-runtime-lib.ts';
import {
	assertDeploymentInitialized,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	runRemoteD1Migrations,
} from './deploy-lib.ts';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from './git-workflow-lib.ts';
import { packageScriptPath, resolveWranglerBin } from './package-tools.ts';
import { runTenantDeployPreflight } from './save-deploy-preflight-lib.ts';

const tenantRoot = process.cwd();
const args = process.argv.slice(2);

function writeDeployReport(payload) {
	const target = process.env.TREESEED_DEPLOY_REPORT_PATH;
	if (!target) {
		return;
	}

	const filePath = resolve(target);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
	const parsed = {
		dryRun: false,
		only: null,
		name: null,
		environment: null,
		targetBranch: null,
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) continue;
		if (current === '--dry-run') {
			parsed.dryRun = true;
			continue;
		}
		if (current === '--only') {
			parsed.only = rest.shift() ?? null;
			continue;
		}
		if (current === '--name') {
			parsed.name = rest.shift() ?? null;
			continue;
		}
		if (current === '--environment') {
			parsed.environment = rest.shift() ?? null;
			continue;
		}
		if (current.startsWith('--environment=')) {
			parsed.environment = current.split('=', 2)[1] ?? null;
			continue;
		}
		if (current === '--target-branch') {
			parsed.targetBranch = rest.shift() ?? null;
			continue;
		}
		if (current.startsWith('--target-branch=')) {
			parsed.targetBranch = current.split('=', 2)[1] ?? null;
			continue;
		}
		throw new Error(`Unknown deploy argument: ${current}`);
	}

	return parsed;
}

function inferEnvironmentFromBranch() {
	const branch = currentManagedBranch(tenantRoot);
	if (branch === STAGING_BRANCH) {
		return 'staging';
	}
	if (branch === PRODUCTION_BRANCH) {
		return 'prod';
	}
	return null;
}

function resolveTarget(options) {
	if (options.targetBranch) {
		return {
			target: createBranchPreviewDeployTarget(options.targetBranch),
			scope: 'staging',
		};
	}

	const environment = options.environment ?? (process.env.CI ? inferEnvironmentFromBranch() : null);
	if (!environment) {
		throw new Error('Treeseed deploy requires `--environment local|staging|prod` outside CI.');
	}

	return {
		target: createPersistentDeployTarget(environment),
		scope: environment,
	};
}

function runNodeScript(scriptPath, scriptArgs = [], env = {}) {
	const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
		stdio: 'inherit',
		cwd: tenantRoot,
		env: { ...process.env, ...env },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function runWranglerDeploy(configPath) {
	const result = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', configPath], {
		stdio: 'inherit',
		cwd: tenantRoot,
		env: { ...process.env },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

async function main() {
	const options = parseArgs(args);
	const { target, scope } = resolveTarget(options);
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope });

	const allowedSteps = new Set(['migrate', 'build', 'publish']);
	if (options.only && !allowedSteps.has(options.only)) {
		throw new Error(`Unsupported deploy step "${options.only}". Expected one of ${[...allowedSteps].join(', ')}.`);
	}

	const shouldRun = (step) => !options.only || options.only === step;
	if (options.name) {
		console.log(`Deploy target label: ${options.name}`);
	}

	if (scope === 'local') {
		runTenantDeployPreflight({ cwd: tenantRoot, scope: 'local' });
		runNodeScript(packageScriptPath('tenant-build'));
		writeDeployReport({ ok: true, kind: 'success', scope, dryRun: options.dryRun, target: deployTargetLabel(target) });
		console.log('Treeseed local deploy completed as a build-only publish target.');
		return;
	}

	try {
		assertDeploymentInitialized(tenantRoot, { target });
		runTenantDeployPreflight({ cwd: tenantRoot, scope });
	} catch (error) {
		writeDeployReport({
			ok: false,
			kind: 'preflight_failed',
			target: deployTargetLabel(target),
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}

	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });

	if (shouldRun('migrate')) {
		const result = runRemoteD1Migrations(tenantRoot, { dryRun: options.dryRun, target });
		console.log(`${options.dryRun ? 'Planned' : 'Applied'} remote migrations for ${result.databaseName}.`);
	}

	if (shouldRun('build')) {
		if (options.dryRun) {
			console.log('Dry run: skipped tenant build.');
		} else {
			runNodeScript(packageScriptPath('tenant-build'));
		}
	}

	if (shouldRun('publish')) {
		if (options.dryRun) {
			console.log(`Dry run: would deploy ${deployTargetLabel(target)} with generated Wrangler config at ${resolve(wranglerPath)}.`);
		} else {
			runWranglerDeploy(wranglerPath);
			finalizeDeploymentState(tenantRoot, { target });
		}
	}

	writeDeployReport({
		ok: true,
		kind: 'success',
		dryRun: options.dryRun,
		only: options.only,
		target: deployTargetLabel(target),
	});
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
