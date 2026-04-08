import test from 'node:test';
import assert from 'node:assert/strict';
import { findCommandSpec, listCommandNames, runTreeseedCli } from '../dist/cli/main.js';
import { makeTenantWorkspace, makeWorkspaceRoot } from './cli-test-fixtures.mjs';

async function runCli(args, options = {}) {
	const writes = [];
	const spawns = [];
	const exitCode = await runTreeseedCli(args, {
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
	assert.match(result.output, /setup/);
	assert.match(result.output, /work/);
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
	const helpViaCommand = await runCli(['help', 'deploy']);
	const helpViaFlag = await runCli(['deploy', '--help']);
	assert.equal(helpViaCommand.exitCode, 0);
	assert.equal(helpViaFlag.exitCode, 0);
	assert.match(helpViaCommand.output, /deploy  Run phase-2 deploy/);
	assert.match(helpViaCommand.output, /--environment <scope>/);
	assert.equal(helpViaCommand.output, helpViaFlag.output);
	assert.equal(helpViaFlag.spawns.length, 0);
});

test('major workflow commands have usage, options, and examples in help', async () => {
	for (const command of ['setup', 'work', 'ship', 'publish', 'promote', 'rollback', 'teardown', 'continue', 'status', 'next', 'doctor']) {
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

test('workspace-only adapter commands still route correctly when not requesting help', async () => {
	const workspaceRoot = makeWorkspaceRoot();
	const result = await runCli(['test:e2e'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 1);
	assert.match(result.spawns[0].args[0], /workspace-command-e2e/);
});

test('status and next support machine-readable json', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/json-status');
	const statusResult = await runCli(['status', '--json'], { cwd: workspaceRoot });
	const nextResult = await runCli(['next', '--json'], { cwd: workspaceRoot });
	const continueResult = await runCli(['continue', '--json'], { cwd: workspaceRoot });
	assert.equal(statusResult.exitCode, 0);
	assert.equal(nextResult.exitCode, 0);
	assert.equal(continueResult.exitCode, 0);
	const statusJson = JSON.parse(statusResult.stdout);
	const nextJson = JSON.parse(nextResult.stdout);
	const continueJson = JSON.parse(continueResult.stdout);
	assert.equal(statusJson.command, 'status');
	assert.equal(statusJson.ok, true);
	assert.equal(statusJson.state.branchRole, 'feature');
	assert.equal(nextJson.command, 'next');
	assert.ok(Array.isArray(nextJson.recommendations));
	assert.equal(continueJson.command, 'continue');
	assert.ok(continueJson.selected);
});

test('legacy workflow commands steer users toward simplified commands', async () => {
	const result = await runCli(['help', 'deploy']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /Prefer `treeseed publish`/);
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

test('setup bootstraps the local workspace and reports next steps', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['setup', '--json'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.command, 'setup');
	assert.equal(payload.ok, true);
	assert.ok(Array.isArray(payload.scopes));
	assert.ok(payload.scopes.includes('local'));
});

test('command metadata stays aligned with help coverage', () => {
	for (const name of listCommandNames()) {
		const command = findCommandSpec(name);
		assert.ok(command?.summary, `${name} should have summary`);
		assert.ok(command?.description, `${name} should have description`);
		assert.ok(command?.executionMode, `${name} should declare an execution mode`);
	}
});
