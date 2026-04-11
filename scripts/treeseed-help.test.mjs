import test from 'node:test';
import assert from 'node:assert/strict';
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

test('workspace-only adapter commands still route correctly when not requesting help', async () => {
	const workspaceRoot = makeWorkspaceRoot();
	const result = await runCli(['test:e2e'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 1);
	assert.match(result.spawns[0].args[0], /workspace-command-e2e/);
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

test('command metadata stays aligned with help coverage', () => {
	for (const name of listCommandNames()) {
		const command = findCommandSpec(name);
		assert.ok(command?.summary, `${name} should have summary`);
		assert.ok(command?.description, `${name} should have description`);
		assert.ok(command?.executionMode, `${name} should declare an execution mode`);
	}
});
