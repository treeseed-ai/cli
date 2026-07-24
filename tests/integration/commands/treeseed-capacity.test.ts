import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
	const registryRoot = resolve(cliPackageRoot, 'src/cli');
	const operationsRegistry = readdirSync(registryRoot)
		.filter((file) => /^(?:operations|overlays)-.+\.ts$/u.test(file) || file === 'operations-registry.ts')
		.map((file) => readFileSync(resolve(registryRoot, file), 'utf8'))
		.join('\n');

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
