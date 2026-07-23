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

test('treeseed with no args prints top-level help and exits successfully', async () => {
	const result = await runCli([]);
	assert.equal(result.exitCode, 0, result.output);
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
	assert.match(helpViaCommand.output, /stage  Promote a locally verified task branch to staging across market and packages\./);
	assert.match(helpViaCommand.output, /<message>/);
	assert.equal(helpViaCommand.output, helpViaFlag.output);
	assert.equal(helpViaFlag.spawns.length, 0);
});

test('auth:login defaults to central and sanitizes loopback approval links from central', async () => {
	const workspace = makeWorkspaceRoot();
	const previousHome = process.env.HOME;
	const previousPassphrase = process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	process.env.HOME = workspace;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] = 'test-passphrase';
	unlockTreeseedSecretSessionFromEnv(workspace);
	const calls = [];
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		calls.push(String(input));
		if (String(input).endsWith('/v1/auth/device/start')) {
			return new Response(JSON.stringify({
				ok: true,
				deviceCode: 'device-test',
				userCode: 'ABCD-EFGH',
				verificationUri: 'http://127.0.0.1:4321/auth/device/approve',
				verificationUriComplete: 'http://127.0.0.1:4321/auth/device/approve?user_code=ABCD-EFGH',
				intervalSeconds: 1,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				expiresInSeconds: 60,
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		return new Response(JSON.stringify({
			ok: true,
			status: 'approved',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			principal: {
				id: 'user-1',
				displayName: 'Test User',
				scopes: ['auth:me', 'market'],
				roles: ['member'],
				permissions: [],
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	try {
		const result = await runCli(['auth:login'], {
			cwd: workspace,
			env: {
				HOME: workspace,
				[TREESEED_MACHINE_KEY_PASSPHRASE_ENV]: 'test-passphrase',
				TREESEED_MARKET_API_BASE_URL: 'http://127.0.0.1:3000',
			},
		});
		assertSuccessWithDiagnostics(result, 'auth:login central default');
		assert.equal(calls[0], 'https://api.treeseed.dev/v1/auth/device/start');
		assert.match(result.stdout, /Open https:\/\/treeseed\.dev\/auth\/device\/approve\?user_code=ABCD-EFGH/u);
		assert.doesNotMatch(result.stdout, /127\.0\.0\.1/u);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousPassphrase === undefined) delete process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
		else process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] = previousPassphrase;
		if (previousTransport === undefined) delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
		else process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
	}
});

test('save help documents optional generated commit message hints', async () => {
	const result = await runCli(['help', 'save']);
	const saveSpec = findCommandSpec('save');
	assert.equal(result.exitCode, 0, result.output);
	assert.equal(saveSpec.arguments[0].required, false);
	assert.match(result.output, /treeseed save/);
	assert.match(result.output, /generated message/);
	assert.doesNotMatch(result.output, /<message>/);
});

test('dev help documents fixed Market web/API/runner runtime', async () => {
	const result = await runCli(['help', 'dev']);
	assert.equal(result.exitCode, 0);
	assert.doesNotMatch(result.output, /--surfaces <surfaces>/);
	assert.doesNotMatch(result.output, /--surface <surface>/);
	assert.match(result.output, /--web-runtime <mode>/);
	assert.match(result.output, /--local-content <mode>/);
	assert.match(result.output, /--force/);
	assert.match(result.output, /web\/API\/runner/u);
	assert.match(result.output, /managed local PostgreSQL/u);
	assert.match(result.output, /Treeseed operations runner/u);
	assert.match(result.output, /capacity/u);
});

test('dev managed subcommands render focused help pages', async () => {
	const logsViaHelp = await runCli(['help', 'dev', 'logs']);
	const logsViaFlag = await runCli(['dev', 'logs', '--help']);
	assert.equal(logsViaHelp.exitCode, 0);
	assert.equal(logsViaFlag.exitCode, 0);
	assert.match(logsViaHelp.output, /dev logs  Read managed dev logs\./);
	assert.match(logsViaHelp.output, /treeseed dev logs \[--follow\] \[--json\]/);
	assert.match(logsViaHelp.output, /--follow/);
	assert.doesNotMatch(logsViaHelp.output, /--web-runtime <mode>/);
	assert.equal(logsViaHelp.output, logsViaFlag.output);
	assert.equal(logsViaFlag.spawns.length, 0);

	const start = await runCli(['help', 'dev', 'start']);
	assert.equal(start.exitCode, 0);
	assert.match(start.output, /dev start  Start a detached worktree-scoped dev instance\./);
	assert.match(start.output, /--web-runtime <mode>/);
	assert.match(start.output, /--local-content <mode>/);
	assert.match(start.output, /--force-conflicts/);
});

test('init help documents repeatable launch host bindings', async () => {
	const result = await runCli(['help', 'init']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /--host <requirement=provider:alias>/u);
	assert.match(result.output, /sourceRepository=github:acme/u);
	assert.match(result.output, /publicWeb=cloudflare:managed/u);
});

test('template show renders starter launch requirements', async () => {
	const result = await runCli(['template', 'show', 'research'], {
		env: {
			TREESEED_TEMPLATE_CATALOG_URL: `file:${resolveSdkCatalogFixturePath()}`,
		},
	});
	assertSuccessWithDiagnostics(result, 'template show research');
	assert.match(result.stdout, /Required Hosts/u);
	assert.match(result.stdout, /sourceRepository/u);
	assert.match(result.stdout, /publicWeb/u);
	assert.match(result.stdout, /Optional Hosts/u);
	assert.match(result.stdout, /transactionalEmail/u);
	assert.match(result.stdout, /Config Writes/u);
	assert.match(result.stdout, /Environment Targets/u);
});

test('template show renders Market control-plane resource requirements', async () => {
	const result = await runCli(['template', 'show', 'market-control-plane'], {
		env: {
			TREESEED_TEMPLATE_CATALOG_URL: `file:${resolveSdkCatalogFixturePath()}`,
		},
	});
	assertSuccessWithDiagnostics(result, 'template show market-control-plane');
	assert.match(result.stdout, /Status:\s+draft/u);
	assert.match(result.stdout, /Resources/u);
	assert.match(result.stdout, /apiDatabase: database required via railway-postgres/u);
	assert.match(result.stdout, /api: service required via railway/u);
	assert.match(result.stdout, /operationsRunner: service required via railway/u);
	assert.match(result.stdout, /TREESEED_DATABASE_URL/u);
	assert.match(result.stdout, /TREESEED_PLATFORM_RUNNER_TOKEN/u);
});

test('init applies local launch host bindings through generated config', async () => {
	const workspace = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-init-hosts-'));
	const result = await runCli([
		'init',
		'generated',
		'--template',
		'research',
		'--name',
		'Generated Research',
		'--site-url',
		'https://research.example.com',
		'--host',
		'sourceRepository=github:acme',
		'--host',
		'publicWeb=cloudflare:managed',
		'--host',
		'transactionalEmail=none',
	], {
		cwd: workspace,
		env: {
			TREESEED_TEMPLATE_CATALOG_URL: `file:${resolveSdkCatalogFixturePath()}`,
		},
	});
	assertSuccessWithDiagnostics(result, 'init --host');
	const siteConfig = readFileSync(resolve(workspace, 'generated', 'treeseed.site.yaml'), 'utf8');
	const envConfig = readFileSync(resolve(workspace, 'generated', 'src', 'env.yaml'), 'utf8');
	const templateState = readFileSync(resolve(workspace, 'generated', '.treeseed', 'template-state.json'), 'utf8');
	assert.match(siteConfig, /sourceRepository/u);
	assert.match(siteConfig, /provider: github/u);
	assert.match(siteConfig, /owner: acme/u);
	assert.match(siteConfig, /publicWeb/u);
	assert.match(siteConfig, /provider: cloudflare/u);
	assert.match(siteConfig, /domain: research\.example\.com/u);
	assert.match(envConfig, /sourceRequirement: sourceRepository/u);
	assert.match(envConfig, /sourceProvider: github/u);
	assert.match(templateState, /hostBindingPlans/u);
	assert.doesNotMatch(`${siteConfig}\n${envConfig}\n${templateState}`, /secret-value|password123|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}/u);
});

test('init rejects invalid local launch host specs before scaffolding', async () => {
	const workspace = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-init-hosts-invalid-'));
	const result = await runCli([
		'init',
		'generated',
		'--template',
		'research',
		'--host',
		'publicWeb=smtp:postmark',
	], {
		cwd: workspace,
		env: {
			TREESEED_TEMPLATE_CATALOG_URL: `file:${resolveSdkCatalogFixturePath()}`,
		},
	});
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /publicWeb requires provider cloudflare/u);
	assert.equal(existsSync(resolve(workspace, 'generated')), false);
});

test('projects help documents deployment parity commands', async () => {
	const result = await runCli(['help', 'projects']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /deploy\|publish\|monitor\|deployments\|deployment/u);
	assert.match(result.output, /--wait/u);
	assert.match(result.output, /--yes/u);
	assert.match(result.output, /Production deploy and publish require/u);
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
			TREESEED_RAILWAY_API_TOKEN: 'railway-token',
			TREESEED_RAILWAY_PROJECT_ID: 'f593a85c-38a2-4e76-a90b-2c20ecf81d6e',
		},
	});

	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 2);
	assert.deepEqual(result.spawns[0].args.slice(-6), ['link', '--project', 'f593a85c-38a2-4e76-a90b-2c20ecf81d6e', '--environment', 'production', '--json']);
	assert.deepEqual(result.spawns[1].args.slice(-2), ['status', '--json']);
	assert.notEqual(result.spawns[1].options.cwd, workspaceRoot);
	assert.equal(result.spawns[1].options.env.HOME, result.spawns[1].options.cwd);
	assert.match(result.spawns[1].options.env.XDG_CONFIG_HOME, /treeseed-railway-prod-/);
});

test('railway wrapper forwards workspace project probes without preselecting project context', async () => {
	const workspaceRoot = makeTenantWorkspace('staging');
	const result = await runCli(['railway', '--environment', 'staging', '--', 'project', 'list', '--json'], {
		cwd: workspaceRoot,
		env: {
			HOME: workspaceRoot,
			TREESEED_RAILWAY_API_TOKEN: 'railway-token',
			TREESEED_RAILWAY_PROJECT_ID: 'f593a85c-38a2-4e76-a90b-2c20ecf81d6e',
		},
	});

	assert.equal(result.exitCode, 0);
	assert.equal(result.spawns.length, 1);
	assert.deepEqual(result.spawns[0].args.slice(-3), ['project', 'list', '--json']);
	assert.equal(result.spawns[0].options.cwd, workspaceRoot);
});

test('export help includes the directory argument', async () => {
	const result = await runCli(['help', 'export']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /treeseed export \[directory\] \[--json\]/);
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

