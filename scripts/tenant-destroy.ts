#!/usr/bin/env node

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from './config-runtime-lib.ts';
import {
	cleanupDestroyedState,
	createPersistentDeployTarget,
	destroyCloudflareResources,
	loadDeployState,
	printDestroySummary,
	validateDestroyPrerequisites,
} from './deploy-lib.ts';
import { deriveCloudflareWorkerName, loadTreeseedDeployConfig } from '@treeseed/core/deploy/config';

const tenantRoot = process.cwd();

function parseArgs(argv) {
	const parsed = {
		dryRun: false,
		force: false,
		skipConfirmation: false,
		confirm: null,
		removeBuildArtifacts: false,
		environment: null,
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) continue;
		if (current === '--dry-run') {
			parsed.dryRun = true;
			continue;
		}
		if (current === '--force') {
			parsed.force = true;
			continue;
		}
		if (current === '--skip-confirmation') {
			parsed.skipConfirmation = true;
			continue;
		}
		if (current === '--confirm') {
			parsed.confirm = rest.shift() ?? null;
			continue;
		}
		if (current === '--remove-build-artifacts') {
			parsed.removeBuildArtifacts = true;
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
		throw new Error(`Unknown destroy argument: ${current}`);
	}

	return parsed;
}

function getExpectedConfirmation(deployConfig) {
	return deployConfig.slug;
}

function printDangerMessage(deployConfig, state, expectedConfirmation) {
	console.error('DANGER: treeseed destroy will permanently delete this site and its Cloudflare resources.');
	console.error(`  Site: ${deployConfig.name}`);
	console.error(`  Slug: ${deployConfig.slug}`);
	console.error(`  Worker: ${state.workerName ?? deriveCloudflareWorkerName(deployConfig)}`);
	console.error(`  D1: ${state.d1Databases.SITE_DATA_DB.databaseName}`);
	console.error(`  KV FORM_GUARD_KV: ${state.kvNamespaces.FORM_GUARD_KV.name}`);
	console.error(`  KV SESSION: ${state.kvNamespaces.SESSION.name}`);
	console.error('  This action is irreversible.');
	console.error(`  To continue, type exactly: ${expectedConfirmation}`);
}

async function readConfirmation(expectedConfirmation) {
	const rl = readline.createInterface({ input, output });
	try {
		return (await rl.question('Confirmation: ')).trim() === expectedConfirmation;
	} finally {
		rl.close();
	}
}

const options = parseArgs(process.argv.slice(2));
const scope = options.environment ?? 'prod';
const target = createPersistentDeployTarget(scope);
applyTreeseedEnvironmentToProcess({ tenantRoot, scope });
assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: !options.dryRun });
const state = loadDeployState(tenantRoot, deployConfig, { target });
const expectedConfirmation = getExpectedConfirmation(deployConfig);

if (!options.skipConfirmation) {
	printDangerMessage(deployConfig, state, expectedConfirmation);

	const confirmed =
		options.confirm !== null ? options.confirm === expectedConfirmation : await readConfirmation(expectedConfirmation);

	if (!confirmed) {
		console.error('Destroy aborted: confirmation text did not match.');
		process.exit(1);
	}
}

const result = destroyCloudflareResources(tenantRoot, {
	dryRun: options.dryRun,
	force: options.force,
	target,
});

printDestroySummary(result);

if (options.dryRun) {
	console.log('Dry run: no remote resources were deleted.');
	process.exit(0);
}

cleanupDestroyedState(tenantRoot, { target, removeBuildArtifacts: options.removeBuildArtifacts });
console.log('Treeseed destroy completed and local deployment state was removed.');
