import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listTreeseedOperationNames } from '@treeseed/sdk/operations';
import { findCommandSpec, listCommandNames, runTreeseedCli } from '../dist/cli/main.js';
import { makeTenantWorkspace, makeWorkspaceRoot } from './cli-test-fixtures.mjs';

async function runCli(args, options = {}) {
	const writes = [];
	const spawns = [];
	const originalHome = process.env.HOME;
	if (typeof options.env?.HOME === 'string') process.env.HOME = options.env.HOME;
	let exitCode;
	try {
		exitCode = await runTreeseedCli(args, {
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, ...(options.env ?? {}) },
			write(output, stream) {
				writes.push({ output, stream });
			},
			spawn(command, spawnArgs) {
				spawns.push({ command, args: spawnArgs });
				return { status: options.spawnStatus ?? 0 };
			},
		});
	} finally {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	}

	return {
		exitCode,
		writes,
		spawns,
		stdout: writes.filter((entry) => entry.stream === 'stdout').map((entry) => entry.output).join('\n'),
		stderr: writes.filter((entry) => entry.stream === 'stderr').map((entry) => entry.output).join('\n'),
		output: writes.map((entry) => entry.output).join('\n'),
	};
}

test('treeseed with no args prints top-level help and exits successfully', async () => {
	const result = await runCli([]);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /Treeseed CLI/);
	assert.match(result.output, /Primary Workflow/);
	assert.match(result.output, /switch/);
	assert.match(result.output, /stage/);
	assert.doesNotMatch(result.output, /treeseed ship/);
});

test('treeseed help entrypoints produce top-level help', async () => {
	const defaultHelp = await runCli(['--help']);
	const shortHelp = await runCli(['-h']);
	const helpCommand = await runCli(['help']);
	assert.equal(defaultHelp.exitCode, 0);
	assert.equal(shortHelp.exitCode, 0);
	assert.equal(helpCommand.exitCode, 0);
	assert.equal(defaultHelp.output, shortHelp.output);
	assert.equal(defaultHelp.output, helpCommand.output);
});

test('treeseed command help renders without executing the command', async () => {
	const helpViaCommand = await runCli(['help', 'stage']);
	const helpViaFlag = await runCli(['stage', '--help']);
	assert.equal(helpViaCommand.exitCode, 0);
	assert.equal(helpViaFlag.exitCode, 0);
	assert.match(helpViaCommand.output, /stage  Merge the current task/);
	assert.match(helpViaCommand.output, /<message>/);
	assert.equal(helpViaCommand.output, helpViaFlag.output);
	assert.equal(helpViaFlag.spawns.length, 0);
});

test('major workflow commands have usage, options, and examples in help', async () => {
	for (const command of ['init', 'status', 'config', 'tasks', 'switch', 'save', 'close', 'stage', 'release', 'destroy', 'rollback', 'doctor']) {
		const result = await runCli(['help', command]);
		assert.equal(result.exitCode, 0, `help for ${command} should exit successfully`);
		assert.match(result.output, /Usage/);
		assert.match(result.output, /Examples/);
	}
});

test('unknown command suggests nearest valid commands', async () => {
	const result = await runCli(['relase']);
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /Unknown treeseed command: relase/);
	assert.match(result.stderr, /release/);
	assert.match(result.stderr, /treeseed help/);
});

test('removed workflow commands are no longer public commands', async () => {
	for (const command of ['setup', 'work', 'ship', 'prepare', 'publish', 'promote', 'teardown', 'start', 'deploy', 'next', 'continue']) {
		const result = await runCli(['help', command]);
		assert.equal(result.exitCode, 1, `${command} should be removed`);
		assert.match(result.output, new RegExp(`Unknown treeseed command: ${command}`));
	}
});

test('published adapter commands still execute in isolated package installs', async () => {
	const workspaceRoot = makeWorkspaceRoot();
	const result = await runCli(['preflight'], { cwd: workspaceRoot });
	assert.equal(typeof result.exitCode, 'number');
	assert.match(result.output, /Treeseed preflight summary/);
	assert.doesNotMatch(result.stderr, /Unknown treeseed command/);
});

test('agents help is rendered locally without requiring the core runtime', async () => {
	const result = await runCli(['agents', '--help']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /treeseed agents <command>/);
	assert.match(result.output, /Delegates to the integrated `@treeseed\/core` agent runtime\./);
	assert.doesNotMatch(result.output, /run-agent <slug>/);
	assert.doesNotMatch(result.output, /release-leases/);
});

test('agent execution reports a clear error when the core runtime is unavailable', async () => {
	const result = await runCli(['agents', 'start'], { cwd: makeTenantWorkspace('feature/no-core-runtime') });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /require the integrated `@treeseed\/core` runtime/);
});

test('status and tasks support machine-readable json', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/json-status');
	const statusResult = await runCli(['status', '--json'], { cwd: workspaceRoot });
	const tasksResult = await runCli(['tasks', '--json'], { cwd: workspaceRoot });
	assert.equal(statusResult.exitCode, 0);
	assert.equal(tasksResult.exitCode, 0);
	const statusJson = JSON.parse(statusResult.stdout);
	const tasksJson = JSON.parse(tasksResult.stdout);
	assert.equal(statusJson.command, 'status');
	assert.equal(statusJson.ok, true);
	assert.equal(statusJson.state.branchRole, 'feature');
	assert.equal(tasksJson.command, 'tasks');
	assert.ok(Array.isArray(tasksJson.tasks));
});

test('doctor reports blocking issues with structured json', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['doctor', '--json'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 1);
	const payload = JSON.parse(result.stderr);
	assert.equal(payload.command, 'doctor');
	assert.equal(payload.ok, false);
	assert.ok(Array.isArray(payload.mustFixNow));
	assert.ok(payload.mustFixNow.some((entry) => /machine config/i.test(entry)));
});

test('config bootstraps the local workspace and reports next steps', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['config', '--environment', 'local', '--sync', 'none', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			GH_TOKEN: 'gh_test',
			CLOUDFLARE_API_TOKEN: 'cf_test',
		},
	});
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.command, 'config');
	assert.equal(payload.ok, true);
	assert.ok(Array.isArray(payload.scopes));
	assert.ok(payload.scopes.includes('local'));
});

test('config defaults to all environments and supports explicit all', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const defaultResult = await runCli(['config', '--print-env-only', '--json'], { cwd: workspaceRoot, env: { HOME: workspaceRoot } });
	const explicitResult = await runCli(['config', '--environment', 'all', '--print-env-only', '--json'], { cwd: workspaceRoot, env: { HOME: workspaceRoot } });
	assert.equal(defaultResult.exitCode, 0);
	assert.equal(explicitResult.exitCode, 0);
	assert.deepEqual(JSON.parse(defaultResult.stdout).scopes, ['local', 'staging', 'prod']);
	assert.deepEqual(JSON.parse(explicitResult.stdout).scopes, ['local', 'staging', 'prod']);
});

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
		writeFileSync(resolve(coreRoot, 'scripts', 'run-ts.mjs'), 'export {};\n');
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

	const result = await runCli(['dev'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 1);
	assert.match(result.spawns[0].args.join(' '), /packages\/core\/scripts\/run-ts\.mjs/);
	assert.match(result.spawns[0].args.join(' '), /packages\/core\/scripts\/dev-platform\.ts/);
});

test('treeseed dev:watch delegates to the installed core entrypoint with --watch', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-installed');
	installCoreDevFixture(workspaceRoot);

	const result = await runCli(['dev:watch'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 1);
	assert.match(result.spawns[0].args.join(' '), /node_modules\/@treeseed\/core\/dist\/scripts\/dev-platform\.js/);
	assert.ok(result.spawns[0].args.includes('--watch'));
});

test('command metadata stays aligned with help coverage', () => {
	for (const name of listCommandNames()) {
		const command = findCommandSpec(name);
		assert.ok(command?.summary, `${name} should have summary`);
		assert.ok(command?.description, `${name} should have description`);
		assert.ok(command?.executionMode, `${name} should declare an execution mode`);
	}
});

test('cli command names are sourced from the sdk operation registry', () => {
	assert.deepEqual(listCommandNames().sort(), listTreeseedOperationNames().sort());
});
