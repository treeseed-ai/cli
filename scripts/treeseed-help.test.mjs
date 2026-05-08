import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { listTreeseedOperationNames } from '@treeseed/sdk/operations';
import { makeTenantWorkspace, makeWorkspaceRoot } from './cli-test-fixtures.mjs';

for (const key of ['CI', 'ACT', 'GITHUB_ACTIONS', 'TREESEED_VERIFY_DRIVER']) {
	delete process.env[key];
}

const { colorizeTreeseedCliOutput, findCommandSpec, listCommandNames, runTreeseedCli } = await import('../dist/cli/main.js');
const { buildTreeseedHelpView } = await import('../dist/cli/help.js');
const { shouldUseInkHelp } = await import('../dist/cli/help-ui.js');
const {
	applyConfigInputInsertion,
	buildCliConfigPages,
	computeConfigViewportLayout,
	filterCliConfigPages,
	normalizeConfigInputChunk,
} = await import('../dist/cli/handlers/config-ui.js');
const { findClickableRegion, routeWheelDeltaToScrollRegion } = await import('../dist/cli/ui/framework.js');
const { parseTerminalMouseInput } = await import('../dist/cli/ui/mouse.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliPackageRoot = resolve(scriptDir, '..');
const repoRoot = resolve(scriptDir, '..', '..', '..');
const require = createRequire(import.meta.url);

function resolveSdkConfigRuntimePath() {
	const workspaceCandidate = resolve(repoRoot, 'packages', 'sdk', 'src', 'operations', 'services', 'config-runtime.ts');
	if (existsSync(workspaceCandidate)) {
		return workspaceCandidate;
	}
	const sdkOperationsEntry = require.resolve('@treeseed/sdk/operations');
	const sdkDistRoot = resolve(dirname(sdkOperationsEntry), 'operations', 'services', 'config-runtime.js');
	if (existsSync(sdkDistRoot)) {
		return sdkDistRoot;
	}
	throw new Error('Unable to resolve SDK config runtime source or dist file for the CLI regression test.');
}

function assertSuccessWithDiagnostics(result, label) {
	if (result.exitCode !== 0) {
		console.error(`[${label}] stdout:\n${result.stdout}`);
		console.error(`[${label}] stderr:\n${result.stderr}`);
	}
	assert.equal(result.exitCode, 0);
}

function ensureTestManagedGh(env) {
	const toolsHome = env?.TREESEED_TOOLS_HOME
		?? (env?.XDG_CACHE_HOME ? resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools') : null)
		?? (env?.HOME ? resolve(env.HOME, '.cache', 'treeseed', 'tools') : null);
	if (!toolsHome) return;
	const ghPath = resolve(toolsHome, 'gh', '2.90.0', `${process.platform}-${process.arch}`, 'bin', 'gh');
	mkdirSync(dirname(ghPath), { recursive: true });
	writeFileSync(ghPath, '#!/bin/sh\necho gh version 2.90.0\n', { mode: 0o755 });
}

function npmInstallTestEnv() {
	return {
		NODE_ENV: 'test',
		TREESEED_TEST_NPM_INSTALL_STATUS: 'installed',
	};
}

async function runCli(args, options = {}) {
	const writes = [];
	const spawns = [];
	ensureTestManagedGh(options.env);
	const envOverrides = {
		TREESEED_KEY_AGENT_TRANSPORT: 'inline',
		CI: undefined,
		ACT: undefined,
		GITHUB_ACTIONS: undefined,
		TREESEED_VERIFY_DRIVER: undefined,
		...(options.env ?? {}),
	};
	const previousEnv = new Map();
	for (const [key, value] of Object.entries(envOverrides)) {
		previousEnv.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	let exitCode;
	try {
		exitCode = await runTreeseedCli(args, {
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, ...envOverrides },
			interactiveUi: options.interactiveUi,
			write(output, stream) {
				writes.push({ output, stream });
			},
			spawn(command, spawnArgs) {
				spawns.push({ command, args: spawnArgs });
				return { status: options.spawnStatus ?? 0 };
			},
		});
	} finally {
		for (const [key, value] of previousEnv.entries()) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
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
	assert.match(result.output, /Featured Commands/);
	assert.match(result.output, /Utilities/);
	assert.match(result.output, /switch/);
	assert.match(result.output, /stage/);
	assert.match(result.output, /agents/);
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
	assert.match(helpViaCommand.output, /stage  Squash a task branch into staging across market and packages\./);
	assert.match(helpViaCommand.output, /<message>/);
	assert.equal(helpViaCommand.output, helpViaFlag.output);
	assert.equal(helpViaFlag.spawns.length, 0);
});

test('save help documents optional generated commit message hints', async () => {
	const result = await runCli(['help', 'save']);
	const saveSpec = findCommandSpec('save');
	assert.equal(result.exitCode, 0);
	assert.equal(saveSpec.arguments[0].required, false);
	assert.match(result.output, /treeseed save/);
	assert.match(result.output, /generated message/);
	assert.doesNotMatch(result.output, /<message>/);
});

test('major workflow commands have usage, options, and examples in help', async () => {
	for (const command of ['init', 'status', 'config', 'tasks', 'switch', 'save', 'close', 'stage', 'release', 'destroy', 'rollback', 'doctor']) {
		const result = await runCli(['help', command]);
		assert.equal(result.exitCode, 0, `help for ${command} should exit successfully`);
		assert.match(result.output, /Overview/);
		assert.match(result.output, /When To Use/);
		assert.match(result.output, /Usage/);
		assert.match(result.output, /Examples/);
		assert.match(result.output, /Automation/);
	}
});

test('config help includes the advanced full-editor flag', async () => {
	const result = await runCli(['help', 'config']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /--full/);
	assert.match(result.output, /--bootstrap/);
	assert.match(result.output, /--system/);
	assert.match(result.output, /--systems/);
	assert.match(result.output, /--skip-unavailable/);
	assert.match(result.output, /--bootstrap-sequential/);
	assert.match(result.output, /--mouse/);
	assert.match(result.output, /--non-interactive/);
	assert.match(result.output, /--install-missing-tooling/);
});

test('global color controls are accepted and documented', async () => {
	const topLevel = await runCli(['--no-color', 'help']);
	const commandHelp = await runCli(['help', 'config', '--no-color']);
	assert.equal(topLevel.exitCode, 0);
	assert.equal(commandHelp.exitCode, 0);
	assert.match(topLevel.output, /--no-color/);
	assert.match(topLevel.output, /NO_COLOR/);
});

test('bootstrap prefix colorization can be disabled', () => {
	const line = '[staging][web][publish][deploy] Uploaded assets.';
	assert.match(colorizeTreeseedCliOutput(line, true), /\u001b\[/);
	assert.equal(colorizeTreeseedCliOutput(line, false), line);
});

test('save progress prefixes are colorized without command prefix', () => {
	const line = '[@treeseed/market][push] $ git push origin staging';
	const colored = colorizeTreeseedCliOutput(line, true);
	assert.match(colored, /^\u001b\[32;1m\[@treeseed\/market\]\[push\]\u001b\[0m /);
	assert.equal(colorizeTreeseedCliOutput(line, false), line);
});

test('railway wrapper selects the requested Railway environment before forwarding args', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['railway', '--environment', 'prod', '--', 'status', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			RAILWAY_API_TOKEN: 'railway-token',
		},
	});

	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 2);
	assert.deepEqual(result.spawns[0].args.slice(-3), ['environment', 'production', '--json']);
	assert.deepEqual(result.spawns[1].args.slice(-2), ['status', '--json']);
});

test('export help includes the directory argument', async () => {
	const result = await runCli(['help', 'export']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /treeseed export \[directory\] \[--worktree <mode>\] \[--json\]/);
});

test('recover help documents stale run pruning', async () => {
	const result = await runCli(['help', 'recover']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /--prune-stale/);
	assert.match(result.output, /stale/i);
});

test('ci help documents hosted workflow inspection options', async () => {
	const result = await runCli(['help', 'ci']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /treeseed ci/);
	assert.match(result.output, /--failed/);
	assert.match(result.output, /--logs/);
	assert.match(result.output, /--log-lines/);
	assert.match(result.output, /read-only/i);
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

test('install command emits a managed dependency report as json', async () => {
	const workspaceRoot = makeWorkspaceRoot();
	const home = resolve(workspaceRoot, '.home');
	const result = await runCli(['install', '--json'], {
		cwd: workspaceRoot,
		env: {
			...npmInstallTestEnv(),
			HOME: home,
			PATH: process.env.PATH,
			TREESEED_TOOLS_HOME: resolve(workspaceRoot, '.tools'),
		},
	});
	assertSuccessWithDiagnostics(result, 'install-json');
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, true);
	assert.ok(Array.isArray(report.npmInstalls));
	assert.equal(report.npmInstalls[0].root, workspaceRoot);
	assert.equal(report.npmInstalls[0].status, 'installed');
	assert.ok(Array.isArray(report.tools));
	assert.ok(report.tools.some((tool) => tool.name === 'gh' && tool.status === 'already-present'));
	assert.ok(report.tools.some((tool) => tool.name === 'wrangler' && tool.kind === 'npm'));
});

test('tools command emits managed executable paths and auth status as json', async () => {
	const workspaceRoot = makeWorkspaceRoot();
	const result = await runCli(['tools', '--json'], {
		cwd: workspaceRoot,
		env: {
			...npmInstallTestEnv(),
			HOME: resolve(workspaceRoot, '.home'),
			PATH: process.env.PATH,
			TREESEED_TOOLS_HOME: resolve(workspaceRoot, '.tools'),
		},
	});
	assertSuccessWithDiagnostics(result, 'tools-json');
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, true);
	assert.match(report.toolsHome, /\.tools$/);
	assert.ok(Array.isArray(report.tools));
	const gh = report.tools.find((tool) => tool.name === 'gh');
	assert.equal(gh.status, 'already-present');
	assert.equal(gh.invocation.mode, 'direct');
	assert.match(gh.invocation.binaryPath, /\/gh$/);
	assert.equal(report.auth.github.checked, true);
	assert.ok(Array.isArray(report.auth.github.remediation));
});

test('install --force repairs npm dependencies even when node_modules exists', async () => {
	const workspaceRoot = makeWorkspaceRoot();
	mkdirSync(resolve(workspaceRoot, 'node_modules'), { recursive: true });
	const result = await runCli(['install', '--force', '--json'], {
		cwd: workspaceRoot,
		env: {
			...npmInstallTestEnv(),
			HOME: resolve(workspaceRoot, '.home'),
			PATH: process.env.PATH,
			TREESEED_TOOLS_HOME: resolve(workspaceRoot, '.tools'),
		},
	});
	assertSuccessWithDiagnostics(result, 'install-force-json');
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, true);
	assert.equal(report.npmInstalls[0].status, 'installed');
	assert.match(report.npmInstalls[0].command.join(' '), /install --no-audit --no-fund/);
});

test('agents help is rendered locally without requiring the core runtime', async () => {
	const result = await runCli(['agents', '--help']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /agents  Run the Treeseed agent runtime namespace\./);
	assert.match(result.output, /treeseed agents <command>/);
	assert.match(result.output, /Delegates to the integrated `@treeseed\/core` agent runtime\./);
	assert.doesNotMatch(result.output, /run-agent <slug>/);
	assert.doesNotMatch(result.output, /release-leases/);
});

test('command help includes aliases from the shared registry metadata', async () => {
	const result = await runCli(['help', 'release:verify']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /test:release:full  Run the full release verification path\./);
	assert.match(result.output, /Aliases/);
	assert.match(result.output, /release:verify/);
});

test('help view model is derived from the command registry', () => {
	const topLevel = buildTreeseedHelpView();
	const commandHelp = buildTreeseedHelpView('config');
	assert.equal(topLevel.kind, 'top');
	assert.ok(topLevel.sections.some((section) => section.title === 'Workflow'));
	assert.ok(topLevel.sections.some((section) => (section.entries ?? []).some((entry) => entry.label === 'config' && entry.targetCommand === 'config')));
	assert.equal(commandHelp.kind, 'command');
	assert.ok(commandHelp.sections.some((section) => section.title === 'Overview'));
	assert.ok(commandHelp.sections.some((section) => section.title === 'When To Use'));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Before You Run'));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Command'));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Behavior'));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Options'));
	assert.ok(commandHelp.sections.some((section) => (section.entries ?? []).some((entry) => entry.label.includes('--full'))));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Related' && (section.entries ?? []).some((entry) => entry.targetCommand === 'status')));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Automation'));
	assert.ok(commandHelp.sections.some((section) => section.title === 'Warnings'));
	assert.match(commandHelp.statusPrimary, /goes back/);
});

test('every visible command exposes rich help metadata through the registry', () => {
	for (const commandName of listCommandNames()) {
		const spec = findCommandSpec(commandName);
		assert.ok(spec, `missing spec for ${commandName}`);
		assert.ok(spec.help, `missing rich help for ${commandName}`);
		assert.ok((spec.help.longSummary ?? []).length > 0, `missing longSummary for ${commandName}`);
		assert.ok((spec.help.whenToUse ?? []).length > 0, `missing whenToUse for ${commandName}`);
		assert.ok((spec.help.beforeYouRun ?? []).length > 0, `missing beforeYouRun for ${commandName}`);
		assert.ok((spec.help.automationNotes ?? []).length > 0, `missing automationNotes for ${commandName}`);
	}
});

test('primary workflow commands expose multiple structured examples', () => {
	for (const commandName of ['status', 'tasks', 'switch', 'save', 'close', 'stage', 'rollback', 'doctor', 'init', 'config', 'export', 'release', 'destroy']) {
		const spec = findCommandSpec(commandName);
		assert.ok(spec?.help, `missing help for ${commandName}`);
		assert.ok((spec.help.examples ?? []).length >= 3, `expected multiple structured examples for ${commandName}`);
		for (const example of spec.help.examples ?? []) {
			assert.equal(typeof example.command, 'string');
			assert.equal(typeof example.title, 'string');
			assert.equal(typeof example.description, 'string');
		}
	}
});

test('shared ui framework routes clicks and wheel scrolling to the matching region', () => {
	let clicked = false;
	let nextOffset = -1;
	const clickRegion = findClickableRegion([
		{ id: 'a', rect: { x: 1, y: 1, width: 5, height: 1 }, onClick: () => { clicked = true; } },
	], 2, 1);
	clickRegion?.onClick();
	assert.equal(clicked, true);

	const didScroll = routeWheelDeltaToScrollRegion([
		{
			id: 'scroll',
			rect: { x: 1, y: 1, width: 10, height: 3 },
			state: { offset: 0, viewportSize: 2, totalSize: 5 },
			onScroll: (offset) => { nextOffset = offset; },
		},
	], 2, 2, 1);
	assert.equal(didScroll, true);
	assert.equal(nextOffset, 1);
});

test('interactive ink help is gated to human tty mode', () => {
	assert.equal(shouldUseInkHelp({ outputFormat: 'json' }), false);
	assert.equal(typeof shouldUseInkHelp({ outputFormat: 'human' }), 'boolean');
	const previousCi = process.env.CI;
	const previousGitHubActions = process.env.GITHUB_ACTIONS;
	const previousAct = process.env.ACT;
	const previousVerifyDriver = process.env.TREESEED_VERIFY_DRIVER;
	try {
		process.env.CI = 'true';
		process.env.GITHUB_ACTIONS = 'true';
		process.env.ACT = 'true';
		process.env.TREESEED_VERIFY_DRIVER = 'act';
		assert.equal(shouldUseInkHelp({ outputFormat: 'human', interactiveUi: true }), false);
		process.env.CI = 'false';
		process.env.GITHUB_ACTIONS = 'false';
		process.env.ACT = 'false';
		process.env.TREESEED_VERIFY_DRIVER = 'direct';
		assert.equal(shouldUseInkHelp({ outputFormat: 'human', interactiveUi: true }), false);
	} finally {
		if (previousCi === undefined) delete process.env.CI;
		else process.env.CI = previousCi;
		if (previousGitHubActions === undefined) delete process.env.GITHUB_ACTIONS;
		else process.env.GITHUB_ACTIONS = previousGitHubActions;
		if (previousAct === undefined) delete process.env.ACT;
		else process.env.ACT = previousAct;
		if (previousVerifyDriver === undefined) delete process.env.TREESEED_VERIFY_DRIVER;
		else process.env.TREESEED_VERIFY_DRIVER = previousVerifyDriver;
	}
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
	assert.ok(statusJson.state.environmentStatus.local);
	assert.ok(statusJson.state.environmentStatus.staging);
	assert.ok(statusJson.state.environmentStatus.prod);
	assert.ok(statusJson.state.providerStatus.local.github);
	assert.ok(statusJson.state.providerStatus.staging.railway);
	assert.equal(statusJson.state.providerStatus.local.railway.applicable, false);
	assert.equal(tasksJson.command, 'tasks');
	assert.ok(Array.isArray(tasksJson.tasks));
});

test('status human fallback groups all environments', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['status'], { cwd: workspaceRoot, interactiveUi: false });
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Local:/);
	assert.match(result.stdout, /Staging:/);
	assert.match(result.stdout, /Production:/);
	assert.match(result.stdout, /Cloudflare: .*local/);
	assert.match(result.stdout, /BLOCKER:|Blockers: none/);
	const stagingSection = result.stdout.slice(result.stdout.indexOf('Staging:'), result.stdout.indexOf('Production:'));
	const productionSection = result.stdout.slice(result.stdout.indexOf('Production:'), result.stdout.indexOf('Managed services:'));
	assert.doesNotMatch(stagingSection, /Local development:/);
	assert.doesNotMatch(productionSection, /Local development:/);
});

test('status live json includes provider live details', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['status', '--live', '--json'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.live, true);
	assert.equal(payload.state.providerStatus.local.github.live.checked, true);
	assert.equal(payload.state.providerStatus.local.railway.applicable, false);
	assert.equal(payload.state.providerStatus.local.railway.live.skipped, true);
	assert.equal(payload.state.providerStatus.local.cloudflare.applicable, false);
	assert.equal(payload.state.providerStatus.local.cloudflare.live.skipped, true);
	assert.equal(payload.state.providerStatus.staging.railway.live.checked, true);
	const localSection = payload.sections.find((section) => section.title === 'Local');
	assert.ok(!localSection.lines.includes('URL: https://example.com'));
	const stagingSection = payload.sections.find((section) => section.title === 'Staging');
	const productionSection = payload.sections.find((section) => section.title === 'Production');
	assert.ok(!stagingSection.lines.some((line) => line.startsWith('Local development:')));
	assert.ok(!productionSection.lines.some((line) => line.startsWith('Local development:')));
});

test('release plan supports machine-readable json without execute-only fields', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['release', '--patch', '--plan', '--json'], { cwd: workspaceRoot });
	assertSuccessWithDiagnostics(result, 'release-plan-json');
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.command, 'release');
	assert.equal(payload.executionMode, 'plan');
	assert.equal(payload.ok, true);
	assert.equal(payload.payload.mode, 'root-only');
	assert.equal(payload.payload.rootVersion, '0.0.1');
	assert.equal(payload.payload.releaseTag, '0.0.1');
	assert.equal(payload.payload.plannedVersions['@treeseed/market'], '0.0.1');
	assert.ok(Array.isArray(payload.payload.plannedSteps));
	assert.ok(payload.payload.plannedSteps.some((step) => step.id === 'release-plan'));
	assert.ok(Array.isArray(payload.payload.plannedPublishWaits));
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
			...npmInstallTestEnv(),
			HOME: workspaceRoot,
			GH_TOKEN: 'gh_test_token',
			TREESEED_GITHUB_OWNER: 'knowledge-coop',
			TREESEED_GITHUB_REPOSITORY_NAME: 'market',
			CLOUDFLARE_API_TOKEN: 'cf_test_token',
			CLOUDFLARE_ACCOUNT_ID: 'cf_account_test',
			RAILWAY_API_TOKEN: 'rw_test_token',
			TREESEED_FORM_TOKEN_SECRET: 'form_token_secret_test_value',
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assertSuccessWithDiagnostics(result, 'config-json-local');
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.command, 'config');
	assert.equal(payload.ok, true);
	assert.ok(Array.isArray(payload.scopes));
	assert.ok(payload.scopes.includes('local'));
	const localEntryIds = new Set(payload.context.entriesByScope.local.map((entry) => entry.id));
	assert.equal(localEntryIds.has('GH_TOKEN'), true);
	assert.equal(localEntryIds.has('TREESEED_GITHUB_OWNER'), true);
	assert.equal(localEntryIds.has('TREESEED_GITHUB_REPOSITORY_NAME'), true);
	assert.equal(localEntryIds.has('TREESEED_GITHUB_REPOSITORY_VISIBILITY'), true);
	assert.equal(localEntryIds.has('CLOUDFLARE_API_TOKEN'), true);
	assert.equal(localEntryIds.has('RAILWAY_API_TOKEN'), false);
	assert.equal(localEntryIds.has('CLOUDFLARE_ACCOUNT_ID'), true);
	assert.equal(localEntryIds.has('TREESEED_RAILWAY_WORKSPACE'), false);
	assert.equal(payload.toolHealth.ghActExtension.attemptedInstall, false);
});

test('config defaults to all environments and supports explicit all', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const env = {
		...npmInstallTestEnv(),
		HOME: workspaceRoot,
		TREESEED_KEY_PASSPHRASE: 'test-passphrase',
	};
	const defaultResult = await runCli(['config', '--print-env-only', '--json'], { cwd: workspaceRoot, env });
	const explicitResult = await runCli(['config', '--environment', 'all', '--print-env-only', '--json'], { cwd: workspaceRoot, env });
	assertSuccessWithDiagnostics(defaultResult, 'config-print-env-default');
	assertSuccessWithDiagnostics(explicitResult, 'config-print-env-explicit-all');
	const defaultPayload = JSON.parse(defaultResult.stdout);
	assert.deepEqual(defaultPayload.scopes, ['local', 'staging', 'prod']);
	assert.deepEqual(JSON.parse(explicitResult.stdout).scopes, ['local', 'staging', 'prod']);
	const localEntryIds = new Set(defaultPayload.context.entriesByScope.local.map((entry) => entry.id));
	const stagingEntryIds = new Set(defaultPayload.context.entriesByScope.staging.map((entry) => entry.id));
	assert.equal(localEntryIds.has('CLOUDFLARE_API_TOKEN'), true);
	assert.equal(localEntryIds.has('RAILWAY_API_TOKEN'), false);
	assert.equal(localEntryIds.has('CLOUDFLARE_ACCOUNT_ID'), true);
	assert.equal(stagingEntryIds.has('CLOUDFLARE_API_TOKEN'), true);
	assert.equal(stagingEntryIds.has('RAILWAY_API_TOKEN'), true);
	assert.equal(stagingEntryIds.has('CLOUDFLARE_ACCOUNT_ID'), true);
});

test('config rejects non-tty execution without explicit automation mode', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['config', '--environment', 'local', '--sync', 'none'], {
		cwd: workspaceRoot,
		env: { HOME: workspaceRoot },
	});
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /requires a TTY/i);
});

test('config does not open the interactive editor when interactive ui is disabled in tests', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const originalStdinIsTTY = process.stdin.isTTY;
	const originalStdoutIsTTY = process.stdout.isTTY;
	Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
	Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
	try {
		const result = await runCli(['config', '--environment', 'local', '--sync', 'none'], {
			cwd: workspaceRoot,
			env: { HOME: workspaceRoot },
			interactiveUi: false,
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /requires a TTY/i);
	} finally {
		Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalStdinIsTTY });
		Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTTY });
	}
});

test('config supports explicit non-interactive application without json output', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['config', '--environment', 'local', '--sync', 'none', '--non-interactive'], {
		cwd: workspaceRoot,
		env: {
			...npmInstallTestEnv(),
			HOME: workspaceRoot,
			GH_TOKEN: 'gh_test_token',
			TREESEED_GITHUB_OWNER: 'knowledge-coop',
			TREESEED_GITHUB_REPOSITORY_NAME: 'market',
			CLOUDFLARE_API_TOKEN: 'cf_test_token',
			RAILWAY_API_TOKEN: 'rw_test_token',
			TREESEED_FORM_TOKEN_SECRET: 'form_token_secret_test_value',
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assertSuccessWithDiagnostics(result, 'config-non-interactive');
	assert.match(result.stdout, /Installing npm dependencies/);
	assert.match(result.stdout, /Treeseed config completed successfully/);
});

test('export defaults to the current shell directory and writes a markdown snapshot', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/export-test');
	const nestedDir = resolve(workspaceRoot, 'src', 'nested');
	mkdirSync(nestedDir, { recursive: true });
	writeFileSync(resolve(nestedDir, 'index.ts'), 'export const nested = true;\n');

	const result = await runCli(['export', '--json'], { cwd: nestedDir });
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.command, 'export');
	assert.equal(payload.ok, true);
	assert.equal(payload.directory, nestedDir);
	assert.match(payload.outputPath, /\.treeseed\/exports\/feature-export-test-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
	assert.equal(readFileSync(payload.outputPath, 'utf8').includes('File: index.ts'), true);
});

test('export accepts an explicit directory positional', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/export-positional');
	const nestedDir = resolve(workspaceRoot, 'src', 'feature');
	mkdirSync(nestedDir, { recursive: true });
	writeFileSync(resolve(nestedDir, 'entry.ts'), 'export const value = 1;\n');

	const result = await runCli(['export', 'src/feature', '--json'], { cwd: workspaceRoot });
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.directory, nestedDir);
	assert.equal(readFileSync(payload.outputPath, 'utf8').includes('File: entry.ts'), true);
});

test('config ui startup page model includes only required unresolved entries and de-duplicates shared entries', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'SHARED_TOKEN', label: 'Shared token', group: 'auth', cluster: 'auth:shared', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_WEB_SERVICE_ID', label: 'Web service ID', group: 'auth', cluster: 'auth:web', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: 'web', effectiveValue: 'web' },
				{ id: 'TREESEED_API_WEB_SERVICE_ID', label: 'API trusted web service ID', group: 'auth', cluster: 'auth:web', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: 'web', effectiveValue: 'web' },
				{ id: 'TREESEED_API_BASE_URL', label: 'API URL', group: 'auth', cluster: 'auth:api', onboardingFeature: null, startupProfile: 'advanced', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config', 'deploy'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: 'http://127.0.0.1:3000', suggestedValue: '', effectiveValue: 'http://127.0.0.1:3000' },
				{ id: 'OPTIONAL_DEFAULTED', label: 'Optional defaulted', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: 'mailpit', effectiveValue: 'mailpit' },
				{ id: 'OPTIONAL_MISSING', label: 'Optional missing', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [
				{ id: 'SHARED_TOKEN', label: 'Shared token', group: 'auth', cluster: 'auth:shared', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_API_BASE_URL', label: 'API URL', group: 'auth', cluster: 'auth:api', onboardingFeature: null, startupProfile: 'advanced', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config', 'deploy'], storage: 'scoped', scope: 'staging', sharedScopes: ['staging'], required: true, currentValue: 'https://staging-api.example.com', suggestedValue: '', effectiveValue: 'https://staging-api.example.com' },
			],
			prod: [
				{ id: 'SHARED_TOKEN', label: 'Shared token', group: 'auth', cluster: 'auth:shared', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'prod', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const entryPages = pages.filter((page) => page.kind === 'entry');
	assert.equal(entryPages.filter((page) => page.entry.id === 'SHARED_TOKEN').length, 1);
	assert.equal(entryPages.some((page) => page.entry.id === 'TREESEED_WEB_SERVICE_ID'), false);
	assert.equal(entryPages.some((page) => page.entry.id === 'TREESEED_API_WEB_SERVICE_ID'), false);
	assert.equal(entryPages.filter((page) => page.entry.id === 'TREESEED_API_BASE_URL').length, 0);
	assert.equal(entryPages.some((page) => page.entry.id === 'OPTIONAL_DEFAULTED'), false);
	assert.equal(entryPages.some((page) => page.entry.id === 'OPTIONAL_MISSING'), true);
});

test('config ui startup includes missing required scoped entries across staging and prod', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'prod', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const smtpScopes = pages
		.filter((page) => page.entry.id === 'TREESEED_SMTP_HOST')
		.map((page) => page.scope);
	assert.deepEqual(smtpScopes, ['local']);
});

test('config ui startup includes required advanced hosted entries that still need attention', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: false, currentValue: '', suggestedValue: '127.0.0.1', effectiveValue: '127.0.0.1' },
			],
			staging: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [
				{ id: 'TREESEED_TURNSTILE_SECRET_KEY', label: 'Turnstile secret key', group: 'forms', cluster: 'turnstile', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'prod', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.deepEqual(
		pages.map((page) => `${page.entry.id}:${page.scope}`),
		['TREESEED_TURNSTILE_SECRET_KEY:prod', 'TREESEED_SMTP_HOST:local'],
	);
});

test('config ui startup keeps invalid required values in the wizard until they are corrected', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [],
			staging: [
				{ id: 'TREESEED_SMTP_PORT', label: 'SMTP port', group: 'smtp', cluster: 'smtp', startupProfile: 'optional', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', validation: { kind: 'number' }, scope: 'staging', sharedScopes: ['staging'], required: true, currentValue: 'mailpit', suggestedValue: '', effectiveValue: 'mailpit' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.deepEqual(pages.map((page) => page.entry.id), ['TREESEED_SMTP_PORT']);
});

test('config ui full page model includes optional resolved entries', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'OPTIONAL_DEFAULTED', label: 'Optional defaulted', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: 'mailpit', effectiveValue: 'mailpit' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.equal(pages.some((page) => page.kind === 'entry' && page.entry.id === 'OPTIONAL_DEFAULTED'), true);
});

test('config ui full page model filters to the selected scope only', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'LOCAL_ONLY', label: 'Local only', group: 'auth', cluster: 'auth:local', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [
				{ id: 'STAGING_ONLY', label: 'Staging only', group: 'auth', cluster: 'auth:staging', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'staging', sharedScopes: ['staging'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.equal(pages.some((page) => page.entry.id === 'LOCAL_ONLY'), true);
	assert.equal(pages.some((page) => page.entry.id === 'STAGING_ONLY'), false);
});

test('config ui full page filter matches id, label, group, and cluster', () => {
	const pages = [
		{
			kind: 'entry',
			key: 'local:TREESEED_SMTP_HOST',
			entry: {
				id: 'TREESEED_SMTP_HOST',
				label: 'SMTP host',
				group: 'smtp',
				cluster: 'smtp',
				startupProfile: 'optional',
				requirement: 'conditional',
				description: '',
				howToGet: '',
				sensitivity: 'plain',
				targets: [],
				purposes: ['config'],
				storage: 'scoped',
				scope: 'local',
				sharedScopes: ['local'],
				required: false,
				currentValue: '',
				suggestedValue: '127.0.0.1',
				effectiveValue: '127.0.0.1',
			},
			scope: 'local',
			scopes: ['local'],
			requiredScopes: [],
			required: false,
			currentValue: '',
			suggestedValue: '127.0.0.1',
			finalValue: '127.0.0.1',
			wizardRequiredMissing: false,
		},
		{
			kind: 'entry',
			key: 'local:TREESEED_FORM_TOKEN_SECRET',
			entry: {
				id: 'TREESEED_FORM_TOKEN_SECRET',
				label: 'Forms token secret',
				group: 'forms',
				cluster: 'forms-core',
				startupProfile: 'core',
				requirement: 'required',
				description: '',
				howToGet: '',
				sensitivity: 'secret',
				targets: [],
				purposes: ['config'],
				storage: 'shared',
				scope: 'local',
				sharedScopes: ['local', 'staging', 'prod'],
				required: true,
				currentValue: '',
				suggestedValue: '',
				effectiveValue: '',
			},
			scope: 'local',
			scopes: ['local'],
			requiredScopes: ['local'],
			required: true,
			currentValue: '',
			suggestedValue: '',
			finalValue: '',
			wizardRequiredMissing: true,
		},
	];
	assert.deepEqual(filterCliConfigPages(pages, 'smtp').map((page) => page.entry.id), ['TREESEED_SMTP_HOST']);
	assert.deepEqual(filterCliConfigPages(pages, 'Forms token').map((page) => page.entry.id), ['TREESEED_FORM_TOKEN_SECRET']);
	assert.deepEqual(filterCliConfigPages(pages, 'forms-core').map((page) => page.entry.id), ['TREESEED_FORM_TOKEN_SECRET']);
});

test('config ui startup keeps clustered variables adjacent across scopes and preserves shared-before-scoped ordering', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [],
			staging: [
				{ id: 'TREESEED_PUBLIC_TURNSTILE_SITE_KEY', label: 'Turnstile site key', group: 'turnstile', cluster: 'turnstile', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_TURNSTILE_SECRET_KEY', label: 'Turnstile secret key', group: 'turnstile', cluster: 'turnstile', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const entryIds = pages
		.filter((page) => page.kind === 'entry')
		.map((page) => `${page.entry.id}:${page.scope}`);
	assert.deepEqual(entryIds, [
		'TREESEED_TURNSTILE_SECRET_KEY:staging',
		'TREESEED_PUBLIC_TURNSTILE_SITE_KEY:staging',
	]);
});

test('config ui orders provider workflow groups before cluster names', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_FORM_TOKEN_SECRET', label: 'Forms token', group: 'forms', cluster: 'z-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare token', group: 'cloudflare', cluster: 'a-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'RAILWAY_API_TOKEN', label: 'Railway token', group: 'railway', cluster: 'm-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.deepEqual(
		pages.map((page) => page.entry.id),
		['CLOUDFLARE_API_TOKEN', 'RAILWAY_API_TOKEN', 'TREESEED_FORM_TOKEN_SECRET'],
	);
});

test('config ui keeps mixed-group Cloudflare account settings adjacent', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare token', group: 'auth', cluster: 'auth:a', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare account ID', group: 'cloudflare', cluster: 'cloudflare:z', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'RAILWAY_API_TOKEN', label: 'Railway token', group: 'railway', cluster: 'railway:a', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	const orderedIds = pages.map((page) => page.entry.id);
	const tokenIndex = orderedIds.indexOf('CLOUDFLARE_API_TOKEN');
	const accountIndex = orderedIds.indexOf('CLOUDFLARE_ACCOUNT_ID');
	assert.equal(Math.abs(tokenIndex - accountIndex), 1);
	assert.equal(orderedIds.at(-1), 'RAILWAY_API_TOKEN');
});

test('config ui keeps short required secret values in the startup wizard', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{
					id: 'RAILWAY_API_TOKEN',
					label: 'Railway token',
					group: 'auth',
					cluster: 'auth:railway',
					onboardingFeature: null,
					startupProfile: 'core',
					requirement: 'required',
					description: '',
					howToGet: '',
					sensitivity: 'secret',
					targets: [],
					purposes: ['config'],
					storage: 'shared',
					scope: 'local',
					sharedScopes: ['local', 'staging', 'prod'],
					required: true,
					validation: { kind: 'nonempty', minLength: 8 },
					currentValue: '0',
					suggestedValue: '',
					effectiveValue: '0',
				},
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.equal(pages.length, 1);
	assert.equal(pages[0].entry.id, 'RAILWAY_API_TOKEN');
	assert.equal(pages[0].wizardRequiredMissing, true);
});

test('config ui viewport layout stays within the terminal height budget', () => {
	const layout = computeConfigViewportLayout(12, 80);
	assert.ok(layout.totalHeight <= 12);
	assert.ok(layout.bodyHeight > 0);
	assert.ok(layout.detailViewportHeight > 0);
	assert.ok(layout.inputHeight > 0);
});

test('config ui normalizes bracketed paste chunks', () => {
	assert.equal(normalizeConfigInputChunk('\u001b[200~multi\nline\u001b[201~'), 'multi\nline');
});

test('config ui strips trailing newlines from pasted config values', () => {
	assert.equal(normalizeConfigInputChunk('secret-value\n'), 'secret-value');
	assert.equal(normalizeConfigInputChunk('\u001b[200~secret-value\r\n\u001b[201~'), 'secret-value');
});

test('config ui applies pasted text at the cursor position', () => {
	const inserted = applyConfigInputInsertion({ value: 'abcdef', cursor: 3 }, 'XYZ');
	assert.deepEqual(inserted, { value: 'abcXYZdef', cursor: 6 });
});

test('config ui preserves multiline bracketed paste content', () => {
	const inserted = applyConfigInputInsertion({ value: '', cursor: 0 }, '\u001b[200~alpha\nbeta\u001b[201~');
	assert.deepEqual(inserted, { value: 'alpha\nbeta', cursor: 'alpha\nbeta'.length });
});

test('terminal mouse parser recognizes sgr mouse release events', () => {
	const events = parseTerminalMouseInput('\u001b[<0;12;5m');
	assert.equal(events.length, 1);
	assert.equal(events[0].x, 11);
	assert.equal(events[0].y, 4);
	assert.equal(events[0].button, 'left');
	assert.equal(events[0].action, 'release');
});

test('sdk config runtime no longer embeds ink hook usage', () => {
	const runtimeSource = readFileSync(resolveSdkConfigRuntimePath(), 'utf8');
	assert.doesNotMatch(runtimeSource, /useStdoutDimensions/);
	assert.doesNotMatch(runtimeSource, /runTreeseedConfigWizard/);
});

test('config ui no longer renders an in-app wizard or view switcher', () => {
	const configUiSource = readFileSync(resolve(cliPackageRoot, 'src', 'cli', 'handlers', 'config-ui.ts'), 'utf8');
	assert.doesNotMatch(configUiSource, /title:\s*'View'/);
	assert.doesNotMatch(configUiSource, /Startup Wizard/);
	assert.doesNotMatch(configUiSource, /Full Editor/);
	assert.doesNotMatch(configUiSource, /Step \$\{step\.index \+ 1\} of \$\{step\.total\}/);
	assert.match(configUiSource, /Wizard mode across/);
	assert.doesNotMatch(configUiSource, /\(empty\)/);
});

test('text input helper copy no longer uses parenthesized empty placeholders', () => {
	const frameworkSource = readFileSync(resolve(cliPackageRoot, 'src', 'cli', 'ui', 'framework.ts'), 'utf8');
	assert.doesNotMatch(frameworkSource, /\(empty\)/);
	assert.doesNotMatch(frameworkSource, /Value is unset\. Type or paste a value\./);
	assert.match(frameworkSource, /props\.secret && props\.value\.length > 0 \? formatSecretMaskedValue\(props\.value\) : props\.value/);
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

	const result = await runCli(['dev', '--surface', 'web', '--port', '4499', '--setup', 'check', '--feedback', 'restart', '--open', 'off', '--plan', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 1);
	assert.match(result.spawns[0].args.join(' '), /packages\/core\/scripts\/run-ts\.mjs/);
	assert.match(result.spawns[0].args.join(' '), /packages\/core\/scripts\/dev-platform\.ts/);
	assert.deepEqual(
		result.spawns[0].args.slice(-12),
		['--surface', 'web', '--port', '4499', '--setup', 'check', '--feedback', 'restart', '--open', 'off', '--plan', '--json'],
	);
});

test('treeseed dev:watch delegates to the installed core entrypoint with --watch', async () => {
	const workspaceRoot = makeTenantWorkspace('feature/dev-installed');
	installCoreDevFixture(workspaceRoot);

	const result = await runCli(['dev:watch'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		},
	});
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
	const cliCommandNames = listCommandNames().sort();
	const sdkCommandNames = listTreeseedOperationNames().sort();
	assert.ok(cliCommandNames.includes('agents'));
	for (const name of sdkCommandNames) {
		assert.ok(cliCommandNames.includes(name), `${name} should be exposed by the CLI registry`);
	}
});
