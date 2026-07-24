import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { listOperationNames } from '@treeseed/sdk/operations';
import {
	MACHINE_KEY_PASSPHRASE_ENV,
	unlockSecretSessionFromEnv,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeTenantWorkspace, makeWorkspaceRoot } from '../../support/cli-test-fixtures.ts';

for (const key of ['CI', 'ACT', 'GITHUB_ACTIONS', 'TREESEED_VERIFY_DRIVER']) {
	delete process.env[key];
}

export const { colorizeCliOutput, findCommandSpec, listCommandNames, runCommandLine } = await import('../../dist/cli/main.js');
export const { buildHelpView } = await import('../../dist/cli/support/help.js');
export const { shouldUseInkHelp } = await import('../../dist/cli/support/help-ui.js');
export const {
	applyConfigInputInsertion,
	buildCliConfigPages,
	computeConfigViewportLayout,
	filterCliConfigPages,
	normalizeConfigInputChunk,
	resolveCurrentConfigValue,
} = await import('../../dist/cli/handlers/configuration/config-ui.js');
export const { findClickableRegion, routeWheelDeltaToScrollRegion } = await import('../../dist/cli/ui/framework.js');
export const { parseTerminalMouseInput } = await import('../../dist/cli/ui/mouse.js');

export const cliPackageRoot = process.cwd();
export const repoRoot = resolve(cliPackageRoot, '..', '..');
export const require = createRequire(import.meta.url);

export function resolveSdkConfigRuntimePath() {
	const workspaceCandidate = resolve(repoRoot, 'packages', 'sdk', 'src', 'operations', 'services', 'configuration', 'config-runtime.ts');
	if (existsSync(workspaceCandidate)) {
		return workspaceCandidate;
	}
	const sdkOperationsEntry = require.resolve('@treeseed/sdk/operations');
	const sdkDistRoot = resolve(dirname(sdkOperationsEntry), 'operations', 'services', 'configuration', 'config-runtime.js');
	if (existsSync(sdkDistRoot)) {
		return sdkDistRoot;
	}
	throw new Error('Unable to resolve SDK config runtime source or dist file for the CLI regression test.');
}

export let testTemplateCatalogPath;

export function templateCatalogItemBase(id, displayName, summary, fulfillmentSource, launchRequirements) {
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

export function starterLaunchRequirements() {
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

export function marketControlPlaneLaunchRequirements() {
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

export function resolveSdkCatalogFixturePath() {
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

export function assertSuccessWithDiagnostics(result, label) {
	if (result.exitCode !== 0) {
		console.error(`[${label}] stdout:\n${result.stdout}`);
		console.error(`[${label}] stderr:\n${result.stderr}`);
	}
	assert.equal(result.exitCode, 0);
}

export function ensureTestManagedGh(env) {
	const toolsHome = env?.TREESEED_TOOLS_HOME?.trim()
		? resolve(env.TREESEED_TOOLS_HOME)
		: env?.XDG_CACHE_HOME?.trim()
			? resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools')
			: resolve(process.cwd(), '.treeseed', 'tools');
	const ghPath = resolve(toolsHome, 'gh', '2.90.0', `${process.platform}-${process.arch}`, 'bin', 'gh');
	mkdirSync(dirname(ghPath), { recursive: true });
	writeFileSync(ghPath, '#!/bin/sh\necho gh version 2.90.0\n', { mode: 0o755 });
}

export function ensureTestManagedRailway(env) {
	const toolsHome = env?.TREESEED_TOOLS_HOME?.trim()
		? resolve(env.TREESEED_TOOLS_HOME)
		: env?.XDG_CACHE_HOME?.trim()
			? resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools')
			: resolve(process.cwd(), '.treeseed', 'tools');
	const railwayPath = resolve(toolsHome, 'railway', '5.23.2', `${process.platform}-${process.arch}`, 'bin', 'railway');
	mkdirSync(dirname(railwayPath), { recursive: true });
	writeFileSync(railwayPath, '#!/bin/sh\necho railway 5.23.2\n', { mode: 0o755 });
}

export function npmInstallTestEnv() {
	return {
		NODE_ENV: 'test',
		TREESEED_TEST_NPM_INSTALL_STATUS: 'installed',
	};
}

export function makeFakeAgentPackageRoot() {
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

export async function runCli(args, options = {}) {
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
		exitCode = await runCommandLine(args, {
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
