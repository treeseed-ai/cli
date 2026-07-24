import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { listOperationNames } from '@treeseed/sdk/operations';
import {
	MACHINE_KEY_PASSPHRASE_ENV,
	unlockSecretSessionFromEnv,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeTenantWorkspace, makeWorkspaceRoot } from '../../../support/cli-test-fixtures.ts';
import {
	applyConfigInputInsertion,
	assertSuccessWithDiagnostics,
	buildCliConfigPages,
	buildHelpView,
	cliPackageRoot,
	colorizeCliOutput,
	computeConfigViewportLayout,
	filterCliConfigPages,
	findClickableRegion,
	findCommandSpec,
	listCommandNames,
	makeFakeAgentPackageRoot,
	normalizeConfigInputChunk,
	npmInstallTestEnv,
	parseTerminalMouseInput,
	resolveCurrentConfigValue,
	resolveSdkCatalogFixturePath,
	resolveSdkConfigRuntimePath,
	routeWheelDeltaToScrollRegion,
	runCli,
	runCommandLine,
	shouldUseInkHelp,
} from '../../../support/help-harness.ts';

function installCoreDevFixture(root, { workspace = false } = {}) {
	if (workspace) {
		const coreRoot = resolve(root, 'packages', 'core');
		mkdirSync(resolve(coreRoot, 'scripts'), { recursive: true });
		writeFileSync(resolve(coreRoot, 'package.json'), JSON.stringify({
			name: '@treeseed/core',
			version: '0.0.0',
			exports: {
				'./scripts/dev-platform': './dist/scripts/dev-platform.js',
			},
		}, null, 2));
		writeFileSync(resolve(coreRoot, 'scripts', 'dev-platform.ts'), 'export {};\n');
		return;
	}

	const coreRoot = resolve(root, 'node_modules', '@treeseed', 'core');
	mkdirSync(resolve(coreRoot, 'dist', 'scripts'), { recursive: true });
	writeFileSync(resolve(coreRoot, 'package.json'), JSON.stringify({
		name: '@treeseed/core',
		version: '0.0.0',
		exports: {
			'./scripts/dev-platform': './dist/scripts/dev-platform.js',
		},
	}, null, 2));
	writeFileSync(resolve(coreRoot, 'dist', 'scripts', 'dev-platform.js'), 'export {};\n');
}

test('treeseed dev delegates to the core dev-platform entrypoint in workspace mode', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-workspace');
	installCoreDevFixture(workspaceRoot, { workspace: true });

	const result = await runCli(['dev', '--port', '4499', '--web-runtime', 'local', '--setup', 'check', '--feedback', 'restart', '--open', 'off', '--local-content', 'preview', '--force', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 0);
	const payload = JSON.parse(result.stdout || result.output);
	assert.equal(payload.command, 'dev');
	assert.equal(payload.ok, true);
	assert.deepEqual(payload.args.slice(payload.args.indexOf('--local-content'), payload.args.indexOf('--local-content') + 2), ['--local-content', 'preview']);
});

test('treeseed dev leaves live feedback disabled when feedback is off', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-feedback-off');
	installCoreDevFixture(workspaceRoot, { workspace: true });

	const result = await runCli(['dev', '--feedback', 'off', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 0);
});

test('treeseed dev forwards managed subcommands with dev subcommand syntax', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-managed-subcommands');
	installCoreDevFixture(workspaceRoot, { workspace: true });

	const start = await runCli(['dev', 'start', '--port', '4501', '--web-runtime', 'local', '--force-conflicts', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(start.exitCode, 0);
	assert.equal(start.spawns.length, 0);
	const startPayload = JSON.parse(start.stdout || start.output);
	assert.equal(startPayload.command, 'dev start');
	assert.equal(startPayload.ok, true);

	const status = await runCli(['dev', 'status', '--all', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(status.spawns.length, 0);
	const statusPayload = JSON.parse(status.stdout || status.output);
	assert.equal(statusPayload.command, 'dev status');
	assert.equal(typeof statusPayload.ok, 'boolean');

	const logs = await runCli(['dev', 'logs', '--follow', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(logs.spawns.length, 0);
	const logsPayload = JSON.parse(logs.stdout || logs.output);
	assert.equal(logsPayload.command, 'dev logs');
	assert.equal(typeof logsPayload.ok, 'boolean');

	const stopAll = await runCli(['dev', 'stop', '--all', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(stopAll.spawns.length, 0);
	const stopAllPayload = JSON.parse(stopAll.stdout || stopAll.output);
	assert.equal(stopAllPayload.command, 'dev stop');
	assert.equal(stopAllPayload.ok, true);
	assert.equal(stopAllPayload.reconcile, undefined);
	assert.doesNotMatch(stopAll.output, /"reconcile"/u);
});

test('treeseed dev api-only plans avoid local treedx reconciliation units', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-api-only');
	installCoreDevFixture(workspaceRoot, { workspace: true });
	const apiRoot = resolve(workspaceRoot, 'packages', 'api');
	mkdirSync(apiRoot, { recursive: true });
	writeFileSync(resolve(apiRoot, 'package.json'), `${JSON.stringify({
		name: '@treeseed/api',
		version: '0.0.0',
		type: 'module',
		scripts: {
			dev: 'node ./dev.js',
			'dev:operations-runner': 'node ./runner.js',
		},
	}, null, 2)}\n`, 'utf8');

	const result = await runCli(['dev', 'restart', '--app', 'api', '--web-runtime', 'local', '--force', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 0);
	const payload = JSON.parse(result.stdout || result.output);
	const serialized = JSON.stringify({
		units: payload.reconcile?.units,
		plans: payload.reconcile?.plans,
		results: payload.reconcile?.results,
		timings: payload.reconcile?.timings,
	});
	assert.equal(payload.command, 'dev restart');
	assert.equal(payload.ok, true);
	assert.equal(payload.selectedSurfaces, 'api');
	assert.match(serialized, /local-process:api/u);
	assert.match(serialized, /local-process:operations-runner/u);
	assert.doesNotMatch(serialized, /local-treedx:team-primary/u);
	assert.doesNotMatch(serialized, /local-docker-compose:treedx/u);
});

test('treeseed dev web-only restart retains runtime dependencies without selecting treedx content sync', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-web-only');
	installCoreDevFixture(workspaceRoot, { workspace: true });
	const apiRoot = resolve(workspaceRoot, 'packages', 'api');
	mkdirSync(apiRoot, { recursive: true });
	writeFileSync(resolve(apiRoot, 'package.json'), `${JSON.stringify({
		name: '@treeseed/api',
		version: '0.0.0',
		type: 'module',
		scripts: {
			dev: 'node ./dev.js',
			'dev:operations-runner': 'node ./runner.js',
		},
	}, null, 2)}\n`, 'utf8');

	const result = await runCli(['dev', 'restart', '--app', 'web', '--web-runtime', 'local', '--local-content', 'none', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(result.exitCode, 0, result.output);
	const payload = JSON.parse(result.stdout || result.output);
	const serialized = JSON.stringify(payload.reconcile);
	assert.match(serialized, /local-process:market-web/u);
	assert.match(serialized, /local-process:api/u);
	assert.match(serialized, /local-docker-compose:api-postgres/u);
	assert.match(serialized, /local-docker-compose:mailpit/u);
	assert.doesNotMatch(serialized, /local-treedx:team-primary/u);
	assert.doesNotMatch(serialized, /local-docker-compose:treedx/u);
});

test('treeseed dev rejects removed surface and worker options', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-surfaces');
	installCoreDevFixture(workspaceRoot, { workspace: true });

	const selectedResult = await runCli(['dev', '--surfaces', 'web,api', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.notEqual(selectedResult.exitCode, 0);
	assert.equal(selectedResult.spawns.length, 0);
	assert.match(selectedResult.stderr, /Unknown option: --surfaces/u);

	const apiResult = await runCli(['dev', '--surface', 'api', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.notEqual(apiResult.exitCode, 0);
	assert.equal(apiResult.spawns.length, 0);
	assert.match(apiResult.stderr, /Unknown option: --surface/u);

	const workerResult = await runCli(['dev', '--with-worker', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.notEqual(workerResult.exitCode, 0);
	assert.equal(workerResult.spawns.length, 0);
	assert.match(workerResult.stderr, /Unknown option: --with-worker/u);
});

test('treeseed dev:manager and dev:watch are no longer public aliases', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-manager');
	installCoreDevFixture(workspaceRoot, { workspace: true });

	const manager = await runCli(['dev:manager', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.notEqual(manager.exitCode, 0);
	assert.equal(manager.spawns.length, 0);
	assert.match(manager.stderr, /Unknown treeseed command: dev:manager/u);

	const watch = await runCli(['dev:watch'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.notEqual(watch.exitCode, 0);
	assert.equal(watch.spawns.length, 0);
	assert.match(watch.stderr, /Unknown treeseed command: dev:watch/u);
});

