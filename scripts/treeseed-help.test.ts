import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { listTreeseedOperationNames } from '@treeseed/sdk/operations';
import {
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeTenantWorkspace, makeWorkspaceRoot } from './cli-test-fixtures.ts';

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
	resolveCurrentConfigValue,
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

let testTemplateCatalogPath;

function templateCatalogItemBase(id, displayName, summary, fulfillmentSource, launchRequirements) {
	return {
		id,
		displayName,
		description: summary,
		summary,
		status: id === 'market-control-plane' ? 'draft' : 'live',
		featured: id !== 'market-control-plane',
		category: 'starter',
		audience: ['maintainers'],
		tags: ['starter'],
		publisher: { id: 'treeseed', name: 'TreeSeed', url: 'https://treeseed.dev' },
		publisherVerified: true,
		templateVersion: '1.0.0',
		templateApiVersion: 1,
		minCliVersion: '0.1.1',
		minCoreVersion: '0.1.2',
		fulfillment: {
			mode: 'git',
			source: fulfillmentSource,
			hooksPolicy: 'builtin_only',
			supportsReconcile: true,
		},
		offer: { priceModel: 'free', license: 'AGPL-3.0-only', support: 'community' },
		relatedBooks: [],
		relatedKnowledge: [],
		relatedObjectives: [],
		launchRequirements,
	};
}

function starterLaunchRequirements() {
	return {
		version: 1,
		hosts: [
			{
				kind: 'host',
				key: 'sourceRepository',
				type: 'repository',
				required: true,
				compatibleProviders: ['github'],
				displayName: 'Source repository',
				purpose: 'Create and push the generated research project repository.',
				defaultSelection: 'team-default',
				configWrites: [
					{ target: 'treeseed.site.yaml', path: 'hosting.hostBindings.sourceRepository.provider', valueFrom: 'selectedHost.provider' },
				],
				environmentWrites: [
					{ env: 'GITHUB_TOKEN', valueFrom: 'selectedHost.token', targets: ['github-secret'], scopes: ['staging', 'prod'], sensitivity: 'secret' },
				],
			},
			{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Public web host',
				purpose: 'Deploy the research site and web runtime resources.',
				defaultSelection: 'managed',
				configWrites: [
					{ target: 'treeseed.site.yaml', path: 'surfaces.web.provider', valueFrom: 'selectedHost.provider' },
				],
				environmentWrites: [
					{ env: 'TREESEED_PUBLIC_WEB_PROVIDER', valueFrom: 'selectedHost.provider', targets: ['github-variable', 'cloudflare-var'], scopes: ['staging', 'prod'], sensitivity: 'plain' },
				],
			},
			{
				kind: 'host',
				key: 'transactionalEmail',
				type: 'email',
				required: false,
				compatibleProviders: ['smtp'],
				displayName: 'Transactional email',
				purpose: 'Send form and account email.',
				defaultSelection: 'none',
				configWrites: [
					{ target: 'treeseed.site.yaml', path: 'services.email.provider', valueFrom: 'selectedHost.provider', writeWhen: 'host-selected' },
				],
				environmentWrites: [],
			},
		],
	};
}

function marketControlPlaneLaunchRequirements() {
	return {
		version: 1,
		hosts: [
			{
				kind: 'host',
				key: 'sourceRepository',
				type: 'repository',
				required: true,
				compatibleProviders: ['github'],
				displayName: 'Market repository',
				purpose: 'Host Market source code.',
				configWrites: [],
			},
			{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Market web host',
				purpose: 'Host Market web/API ingress.',
				configWrites: [],
			},
		],
		resources: [
			{
				kind: 'resource',
				key: 'apiDatabase',
				type: 'database',
				required: true,
				compatibleProviders: ['railway-postgres'],
				displayName: 'Market database',
				purpose: 'Store Market state.',
				configWrites: [
					{ target: 'treeseed.site.yaml', path: 'services.apiDatabase.provider', valueFrom: 'selectedResource.provider' },
				],
				environmentWrites: [
					{ env: 'TREESEED_DATABASE_URL', valueFrom: 'selectedResource.connectionUrl', targets: ['railway-secret'], scopes: ['staging', 'prod'], sensitivity: 'secret' },
				],
			},
			{
				kind: 'resource',
				key: 'api',
				type: 'service',
				required: true,
				compatibleProviders: ['railway'],
				displayName: 'API',
				purpose: 'Run the API service.',
				configWrites: [],
			},
			{
				kind: 'resource',
				key: 'operationsRunner',
				type: 'service',
				required: true,
				compatibleProviders: ['railway'],
				displayName: 'Treeseed operations runner',
				purpose: 'Run Market operations.',
				configWrites: [],
				environmentWrites: [
					{ env: 'TREESEED_PLATFORM_RUNNER_TOKEN', valueFrom: 'generated.runnerToken', targets: ['railway-secret'], scopes: ['staging', 'prod'], sensitivity: 'secret' },
				],
			},
		],
		secrets: [
			{ kind: 'secret', key: 'apiDatabaseUrl', env: 'TREESEED_DATABASE_URL', required: true, targets: ['railway-secret'], sensitivity: 'secret', source: 'selected-host' },
			{ kind: 'secret', key: 'platformRunnerToken', env: 'TREESEED_PLATFORM_RUNNER_TOKEN', required: true, targets: ['railway-secret'], sensitivity: 'secret', source: 'generated' },
		],
	};
}

function resolveSdkCatalogFixturePath() {
	if (testTemplateCatalogPath) {
		return testTemplateCatalogPath;
	}
	const catalogRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-template-catalog-'));
	testTemplateCatalogPath = resolve(catalogRoot, 'catalog.fixture.json');
	writeFileSync(testTemplateCatalogPath, `${JSON.stringify({
		items: [
			templateCatalogItemBase('research', 'TreeSeed Research', 'Research starter.', {
				kind: 'git',
				repoUrl: 'https://github.com/treeseed-templates/research.git',
				directory: '.',
				ref: 'staging',
				integrity: 'cli-test',
			}, starterLaunchRequirements()),
			templateCatalogItemBase('market-control-plane', 'TreeSeed Market Control Plane', 'Market control-plane template.', {
				kind: 'git',
				repoUrl: 'https://github.com/treeseed-ai/market.git',
				directory: '.',
				ref: 'staging',
				integrity: 'cli-test',
			}, marketControlPlaneLaunchRequirements()),
		],
	}, null, 2)}\n`, 'utf8');
	return testTemplateCatalogPath;
}

function assertSuccessWithDiagnostics(result, label) {
	if (result.exitCode !== 0) {
		console.error(`[${label}] stdout:\n${result.stdout}`);
		console.error(`[${label}] stderr:\n${result.stderr}`);
	}
	assert.equal(result.exitCode, 0);
}

function ensureTestManagedGh(env) {
	const toolsHome = env?.TREESEED_TOOLS_HOME?.trim()
		? resolve(env.TREESEED_TOOLS_HOME)
		: env?.XDG_CACHE_HOME?.trim()
			? resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools')
			: resolve(process.cwd(), '.treeseed', 'tools');
	const ghPath = resolve(toolsHome, 'gh', '2.90.0', `${process.platform}-${process.arch}`, 'bin', 'gh');
	mkdirSync(dirname(ghPath), { recursive: true });
	writeFileSync(ghPath, '#!/bin/sh\necho gh version 2.90.0\n', { mode: 0o755 });
}

function ensureTestManagedRailway(env) {
	const toolsHome = env?.TREESEED_TOOLS_HOME?.trim()
		? resolve(env.TREESEED_TOOLS_HOME)
		: env?.XDG_CACHE_HOME?.trim()
			? resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools')
			: resolve(process.cwd(), '.treeseed', 'tools');
	const railwayPath = resolve(toolsHome, 'railway', '5.23.2', `${process.platform}-${process.arch}`, 'bin', 'railway');
	mkdirSync(dirname(railwayPath), { recursive: true });
	writeFileSync(railwayPath, '#!/bin/sh\necho railway 5.23.2\n', { mode: 0o755 });
}

function npmInstallTestEnv() {
	return {
		NODE_ENV: 'test',
		TREESEED_TEST_NPM_INSTALL_STATUS: 'installed',
	};
}

function makeFakeAgentPackageRoot() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-agent-package-'));
	mkdirSync(resolve(root, 'dist', 'provider'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), `${JSON.stringify({ name: '@treeseed/agent', type: 'module' }, null, 2)}\n`, 'utf8');
	writeFileSync(resolve(root, 'dist', 'provider', 'entrypoint.js'), `console.log(JSON.stringify({
	ok: true,
	budgets: {
		nativeCapacity: {
			executionProviders: [{
				id: 'local-codex',
				name: 'Local Codex',
				kind: 'codex',
				nativeUnit: 'wall_minute',
				maxConcurrentWorkers: 4,
				nativeLimits: [{ scope: 'daily', nativeUnit: 'wall_minute', limitAmount: 480, reserveBufferPercent: 20 }],
			}],
		},
	},
}));\n`, 'utf8');
	writeFileSync(resolve(root, 'compose.capacity-provider.yml'), 'services:\n  api:\n    image: capacity-provider:local\n', 'utf8');
	return root;
}

async function runCli(args, options = {}) {
	const writes = [];
	const spawns = [];
	const effectiveEnv = { ...process.env, ...(options.env ?? {}) };
	ensureTestManagedGh(effectiveEnv);
	ensureTestManagedRailway(effectiveEnv);
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
			spawn(command, spawnArgs, spawnOptions) {
				spawns.push({ command, args: spawnArgs, options: spawnOptions });
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
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.deepEqual(
		pages.map((page) => `${page.entry.id}:${page.scope}`),
		['TREESEED_SMTP_HOST:local'],
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

test('config ui helpers tolerate environment-limited config contexts', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['staging'],
		configReadinessByScope: {
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			staging: [
				{ id: 'TREESEED_HOSTED_HUBS_GITHUB_OWNER', label: 'Hosted owner', group: 'github', cluster: 'github:hosted', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_GITHUB_TOKEN', label: 'GitHub token', group: 'github', cluster: 'github:token', startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: 'gh-token', suggestedValue: '', effectiveValue: 'gh-token' },
			],
		},
	};

	assert.equal(resolveCurrentConfigValue(context, {}, 'TREESEED_GITHUB_TOKEN', 'local'), 'gh-token');
	assert.deepEqual(
		buildCliConfigPages(context, 'local', {}, 'startup').map((page) => page.entry.id),
		['TREESEED_HOSTED_HUBS_GITHUB_OWNER'],
	);
	assert.deepEqual(buildCliConfigPages(context, 'local', {}, 'full'), []);
	assert.equal(buildCliConfigPages(context, 'staging', {}, 'full').length, 2);
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
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_SMTP_PASSWORD', label: 'SMTP password', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const entryIds = pages
		.filter((page) => page.kind === 'entry')
		.map((page) => `${page.entry.id}:${page.scope}`);
	assert.deepEqual(entryIds, [
		'TREESEED_SMTP_HOST:staging',
		'TREESEED_SMTP_PASSWORD:staging',
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
				{ id: 'TREESEED_CLOUDFLARE_API_TOKEN', label: 'Cloudflare token', group: 'cloudflare', cluster: 'a-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_RAILWAY_API_TOKEN', label: 'Railway token', group: 'railway', cluster: 'm-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.deepEqual(
		pages.map((page) => page.entry.id),
		['TREESEED_CLOUDFLARE_API_TOKEN', 'TREESEED_RAILWAY_API_TOKEN', 'TREESEED_FORM_TOKEN_SECRET'],
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
				{ id: 'TREESEED_CLOUDFLARE_API_TOKEN', label: 'Cloudflare token', group: 'auth', cluster: 'auth:a', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare account ID', group: 'cloudflare', cluster: 'cloudflare:z', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_RAILWAY_API_TOKEN', label: 'Railway token', group: 'railway', cluster: 'railway:a', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	const orderedIds = pages.map((page) => page.entry.id);
	const tokenIndex = orderedIds.indexOf('TREESEED_CLOUDFLARE_API_TOKEN');
	const accountIndex = orderedIds.indexOf('TREESEED_CLOUDFLARE_ACCOUNT_ID');
	assert.equal(Math.abs(tokenIndex - accountIndex), 1);
	assert.equal(orderedIds.at(-1), 'TREESEED_RAILWAY_API_TOKEN');
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
					id: 'TREESEED_RAILWAY_API_TOKEN',
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
	assert.equal(pages[0].entry.id, 'TREESEED_RAILWAY_API_TOKEN');
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

test('capacity lifecycle commands route through package-owned scripts and Compose with redacted env', async () => {
	const agentRoot = makeFakeAgentPackageRoot();
	const workspaceRoot = makeWorkspaceRoot();
	const secret = Buffer.from('{"tokens":{"access_token":"sensitive"}}').toString('base64');
	try {
		const build = await runCli(['capacity', 'build', '--agent-package-root', agentRoot, '--plan', '--json'], { cwd: workspaceRoot });
		assert.equal(build.exitCode, 0);
		assert.equal(build.spawns.length, 0);

		const up = await runCli(['capacity', 'up', '--market', 'local', '--provider', 'local', '--agent-package-root', agentRoot, '--plan', '--json'], {
			cwd: workspaceRoot,
			env: {
				TREESEED_CODEX_AUTH_JSON_B64: secret,
			},
		});
		assert.equal(up.exitCode, 0);
		assert.equal(up.spawns.length, 0);
		assert.doesNotMatch(up.output, new RegExp(secret, 'u'));
		const upPayload = JSON.parse(up.output);
		assert.equal(upPayload.command, 'capacity up');
		assert.equal(upPayload.ok, true);

		const diagnostic = await runCli(['capacity', 'up', '--market', 'local', '--provider', 'local', '--agent-package-root', agentRoot, '--diagnostic', '--plan', '--json'], { cwd: workspaceRoot });
		assert.equal(diagnostic.exitCode, 0);
		assert.equal(diagnostic.spawns.length, 0);
		assert.equal(JSON.parse(diagnostic.output).command, 'capacity up');

		const status = await runCli(['capacity', 'status', '--market', 'local', '--provider', 'local', '--agent-package-root', agentRoot, '--json'], { cwd: workspaceRoot });
		assert.equal(status.spawns.length, 0);
		assert.equal(JSON.parse(status.output).command, 'capacity status');

		const providerPlan = await runCli(['capacity', 'plan', '--market', 'local', '--provider', 'local', '--agent-package-root', agentRoot, '--json'], { cwd: workspaceRoot });
		assert.equal(providerPlan.spawns.length, 0);
		assert.equal(JSON.parse(providerPlan.output).command, 'capacity plan');
	} finally {
		rmSync(agentRoot, { recursive: true, force: true });
		rmSync(workspaceRoot, { recursive: true, force: true });
	}
});

test('capacity diagnostics reads Market derived capacity projection', async () => {
	const root = makeWorkspaceRoot();
	const previousHome = process.env.HOME;
	const previousPassphrase = process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	process.env.HOME = root;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] = 'test-passphrase';
	unlockTreeseedSecretSessionFromEnv(root);
	const previousFetch = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (input, init) => {
		calls.push({ input: String(input), init });
		assert.match(String(input), /\/v1\/projects\/project_123\/capacity-diagnostics\?environment=local$/u);
		assert.equal(init?.headers?.authorization, 'Bearer test-access-token');
		return new Response(JSON.stringify({
			ok: true,
			payload: {
				projectId: 'project_123',
				environment: 'local',
				derivedCapacity: {
					totalDerivedAvailableCredits: 42,
					entries: [{
						executionProviderKind: 'codex',
						nativeUnit: 'wall_minute',
						configuredNativeLimit: 480,
						observedNativeRemaining: 300,
						activeReservedNativeAmount: 60,
						reserveBufferPercent: 20,
						nativeUnitsPerCredit: 10,
						derivedAvailableCredits: 24,
						confidence: 'high',
					}],
				},
				grants: [{
					grantScope: 'project',
					environment: 'local',
					portfolioAllocationPercent: 100,
					reservePoolPercent: 10,
					maxDailyProjectCredits: 5000,
					overflowPolicy: 'soft_grant',
				}],
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	try {
		setMarketSession(root, {
			marketId: 'local',
			accessToken: 'test-access-token',
			principal: { id: 'user-1', roles: [], permissions: [] },
		});
		const result = await runCli(['capacity', 'diagnostics', '--market', 'local', '--project', 'project_123', '--environment', 'local'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 0, result.stderr);
		assert.equal(calls.length, 1);
		assert.match(result.output, /Native projection/u);
		assert.match(result.output, /codex:wall_minute/u);
		assert.match(result.output, /derived 24 credits/u);
		assert.match(result.output, /allocation 100%/u);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousTransport === undefined) delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
		else process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
		if (previousPassphrase === undefined) delete process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
		else process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] = previousPassphrase;
	}
});

test('capacity removes old helper-capacity actions', async () => {
	const agentRoot = makeFakeAgentPackageRoot();
	try {
		const result = await runCli(['capacity', 'providers', '--agent-package-root', agentRoot]);
		assert.notEqual(result.exitCode, 0);
		assert.match(result.stderr, /Unknown capacity action "providers"/u);
	} finally {
		rmSync(agentRoot, { recursive: true, force: true });
	}
});

test('capacity inspection exposes read-only execution visibility summaries', () => {
	const capacityHandler = readFileSync(resolve(cliPackageRoot, 'src/cli/handlers/capacity-inspection-projection.ts'), 'utf8');
	const operationsRegistry = readFileSync(resolve(cliPackageRoot, 'src/cli/operations-registry.ts'), 'utf8');

	assert.match(capacityHandler, /decorateExecutionProviderVisibility/u);
	assert.match(capacityHandler, /summarizeExecutionProviderVisibility/u);
	assert.match(capacityHandler, /execution=/u);
	assert.match(capacityHandler, /adapter=/u);
	assert.match(capacityHandler, /external=/u);
	assert.match(operationsRegistry, /execution visibility and capability match summaries/u);
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
