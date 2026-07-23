import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { listTreeseedOperationNames } from '@treeseed/sdk/operations';
import {
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeTenantWorkspace, makeWorkspaceRoot } from '../../support/cli-test-fixtures.ts';
import {
	applyConfigInputInsertion,
	assertSuccessWithDiagnostics,
	buildCliConfigPages,
	buildTreeseedHelpView,
	cliPackageRoot,
	colorizeTreeseedCliOutput,
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
	runTreeseedCli,
	shouldUseInkHelp,
} from '../../support/treeseed-help-harness.ts';

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

test('install --force leaves a healthy installed dependency graph untouched', async () => {
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
	assert.equal(report.npmInstalls[0].status, 'already-present');
	assert.match(report.npmInstalls[0].detail, /force is limited to Treeseed-managed tool repair/);
	assert.match(report.npmInstalls[0].command.join(' '), /install --ignore-scripts --prefer-offline --workspaces=false --no-audit --no-fund/);
});

test('agents help is rendered locally without requiring the core runtime', async () => {
	const result = await runCli(['agents', '--help']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /agents  Run the Treeseed agent runtime namespace\./);
	assert.match(result.output, /treeseed agents <command>/);
	assert.match(result.output, /Delegates to the `@treeseed\/agent` runtime\./);
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
	assert.equal(payload.payload.mode, 'reconcile-release-gates');
	assert.equal(payload.payload.rootVersion, '0.0.1');
	assert.equal(payload.payload.releaseTag, '0.0.1');
	assert.equal(payload.payload.plannedVersions['@treeseed/market'], '0.0.1');
	assert.ok(Array.isArray(payload.payload.plannedSteps));
	assert.ok(payload.payload.plannedSteps.some((step) => step.id.includes('release-gate:')));
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
			TREESEED_GITHUB_TOKEN: 'gh_test_token',
			TREESEED_GITHUB_OWNER: 'knowledge-coop',
			TREESEED_GITHUB_REPOSITORY_NAME: 'market',
			TREESEED_CLOUDFLARE_API_TOKEN: 'cf_test_token',
			TREESEED_CLOUDFLARE_ACCOUNT_ID: 'cf_account_test',
			TREESEED_RAILWAY_API_TOKEN: 'rw_test_token',
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
	assert.equal(localEntryIds.has('TREESEED_GITHUB_TOKEN'), true);
	assert.equal(localEntryIds.has('TREESEED_GITHUB_OWNER'), true);
	assert.equal(localEntryIds.has('TREESEED_GITHUB_REPOSITORY_NAME'), true);
	assert.equal(localEntryIds.has('TREESEED_GITHUB_REPOSITORY_VISIBILITY'), true);
	assert.equal(localEntryIds.has('TREESEED_CLOUDFLARE_API_TOKEN'), true);
	assert.equal(localEntryIds.has('TREESEED_RAILWAY_API_TOKEN'), false);
	assert.equal(localEntryIds.has('TREESEED_CLOUDFLARE_ACCOUNT_ID'), true);
	assert.equal(localEntryIds.has('TREESEED_RAILWAY_WORKSPACE'), false);
	assert.equal(payload.toolHealth.ghActExtension.attemptedInstall, false);
	assert.ok(Array.isArray(payload.nextSteps));
	assert.equal(payload.nextSteps.some((step) => /Host env injection exposes runtime secrets/u.test(step)), false);
	assert.equal(payload.nextSteps.some((step) => /Bootstrap service secrets are crown-jewel/u.test(step)), false);
	assert.equal(payload.nextSteps.some((step) => /Admin browser encryption depends/u.test(step)), false);
	assert.equal(payload.nextSteps.some((step) => /Secret-bearing workflows must use/u.test(step)), false);
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
	assert.equal(localEntryIds.has('TREESEED_CLOUDFLARE_API_TOKEN'), true);
	assert.equal(localEntryIds.has('TREESEED_RAILWAY_API_TOKEN'), false);
	assert.equal(localEntryIds.has('TREESEED_CLOUDFLARE_ACCOUNT_ID'), true);
	assert.equal(stagingEntryIds.has('TREESEED_CLOUDFLARE_API_TOKEN'), true);
	assert.equal(stagingEntryIds.has('TREESEED_RAILWAY_API_TOKEN'), false);
	assert.equal(stagingEntryIds.has('TREESEED_CLOUDFLARE_ACCOUNT_ID'), true);
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
			TREESEED_GITHUB_TOKEN: 'gh_test_token',
			TREESEED_GITHUB_OWNER: 'knowledge-coop',
			TREESEED_GITHUB_REPOSITORY_NAME: 'market',
			TREESEED_CLOUDFLARE_API_TOKEN: 'cf_test_token',
			TREESEED_CLOUDFLARE_ACCOUNT_ID: 'cf_account_test',
			TREESEED_RAILWAY_API_TOKEN: 'rw_test_token',
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

