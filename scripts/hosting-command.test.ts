import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeWorkspaceRoot } from './cli-test-fixtures.ts';

const { runTreeseedCli } = await import('../dist/cli/main.js');

function makeMarketWorkspace() {
	const root = makeWorkspaceRoot();
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: treeseed_control_plane
  teamId: treeseed
  projectId: market
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: account-123
  r2:
    manifestKeyTemplate: teams/{teamId}/published/common.json
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
services:
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:api
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: treeseed-api-postgres
  operationsRunner:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      serviceName: treeseed-ops-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
smtp:
  enabled: true
`, 'utf8');
	return root;
}

function makeSplitMarketWorkspace() {
	const root = makeWorkspaceRoot();
	mkdirSync(resolve(root, 'packages', 'api'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: '@treeseed/market',
		type: 'module',
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: self_hosted_project
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
connections:
  api:
    proxyPrefix: /v1
    localBaseUrl: http://127.0.0.1:3000
`, 'utf8');
	writeFileSync(resolve(root, 'packages', 'api', 'package.json'), JSON.stringify({
		name: '@treeseed/api',
		type: 'module',
	}, null, 2));
	writeFileSync(resolve(root, 'packages', 'api', 'treeseed.site.yaml'), `name: TreeSeed API
slug: treeseed-api
siteUrl: https://api.treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  api:
    enabled: true
    provider: railway
    rootDir: .
services:
  api:
    enabled: true
    provider: railway
    rootDir: .
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: .
      buildCommand: npm run build
      startCommand: npm run start:api
  operationsRunner:
    enabled: true
    provider: railway
    rootDir: .
    railway:
      serviceName: treeseed-ops-01
      rootDir: .
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets:
        - api
        - operationsRunner
`, 'utf8');
	return root;
}

async function runCli(args, cwd) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
		cwd,
		env: {
			...process.env,
			NODE_ENV: 'test',
			CI: undefined,
			ACT: undefined,
			GITHUB_ACTIONS: undefined,
			TREESEED_VERIFY_DRIVER: undefined,
		},
		interactiveUi: false,
		write(output, stream) {
			writes.push({ output, stream });
		},
		spawn() {
			return { status: 0 };
		},
	});
	const stdout = writes.filter((entry) => entry.stream === 'stdout').map((entry) => entry.output).join('\n');
	const stderr = writes.filter((entry) => entry.stream === 'stderr').map((entry) => entry.output).join('\n');
	return { exitCode, stdout, stderr };
}

function parseJsonOutput(stdout) {
	const start = stdout.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${stdout}`);
	return JSON.parse(stdout.slice(start));
}

test('hosting plan emits placement-first JSON for staging', async () => {
	const cwd = makeMarketWorkspace();
	const result = await runCli(['hosting', 'plan', '--environment', 'staging', '--placement-only', '--json'], cwd);
	assert.equal(result.exitCode, 0, result.stderr);
	const payload = parseJsonOutput(result.stdout);

	assert.equal(payload.environment, 'staging');
	assert.ok(payload.placements.some((placement) => placement.placement === 'knowledge-library'));
	assert.ok(payload.units.some((entry) =>
		entry.unit.id === 'public-treedx-node-01'
		&& entry.unit.hostId === 'railway'
		&& entry.unit.projectGroupId === 'public-treedx-federation'));
});

test('hosting plan refuses live verification claims', async () => {
	const cwd = makeMarketWorkspace();
	const result = await runCli(['hosting', 'plan', '--environment', 'staging', '--live', '--json'], cwd);
	assert.equal(result.exitCode, 1);

	assert.match(result.stdout + result.stderr, /cannot prove live provider state/u);
});

test('hosting pending-volume replacement is apply-only and requires explicit confirmation', async () => {
	const cwd = makeMarketWorkspace();
	const planResult = await runCli(['hosting', 'plan', '--environment', 'prod', '--replace-pending-volumes', '--yes', '--json'], cwd);
	assert.equal(planResult.exitCode, 1);
	assert.match(planResult.stdout + planResult.stderr, /available only with `hosting apply`/u);

	const unconfirmedApply = await runCli(['hosting', 'apply', '--environment', 'prod', '--replace-pending-volumes', '--json'], cwd);
	assert.equal(unconfirmedApply.exitCode, 1);
	assert.match(unconfirmedApply.stdout + unconfirmedApply.stderr, /permanently discards queued Railway volume data and requires --yes/u);
});

test('hosting plan can target API service only', async () => {
	const cwd = makeMarketWorkspace();
	const result = await runCli(['hosting', 'plan', '--environment', 'staging', '--service', 'api', '--placement-only', '--json'], cwd);
	assert.equal(result.exitCode, 0, result.stderr);
	const payload = parseJsonOutput(result.stdout);

	assert.deepEqual(payload.units.map((entry) => entry.unit.id), ['api']);
	assert.equal(payload.units[0].unit.config.rootDir, 'packages/api');
});

test('hosting plan can target split web and api applications', async () => {
	const cwd = makeSplitMarketWorkspace();
	const webResult = await runCli(['hosting', 'plan', '--environment', 'staging', '--app', 'web', '--placement-only', '--json'], cwd);
	const apiResult = await runCli(['hosting', 'plan', '--environment', 'staging', '--app', 'api', '--placement-only', '--json'], cwd);
	assert.equal(webResult.exitCode, 0, webResult.stderr);
	assert.equal(apiResult.exitCode, 0, apiResult.stderr);
	const webPayload = parseJsonOutput(webResult.stdout);
	const apiPayload = parseJsonOutput(apiResult.stdout);

	assert.deepEqual(webPayload.units.map((entry) => entry.unit.id), ['web']);
	assert.ok(apiPayload.units.some((entry) => entry.unit.id === 'api' && entry.unit.config.rootDir === '.'));
	assert.ok(apiPayload.units.some((entry) => entry.unit.id === 'public-treedx-node-01'));
});

test('hosting plan selects split API runtime and public TreeDX units', async () => {
	const cwd = makeSplitMarketWorkspace();
	const result = await runCli(['hosting', 'plan', '--environment', 'staging', '--app', 'api', '--placement-only', '--json'], cwd);
	assert.equal(result.exitCode, 0, result.stderr);
	const payload = parseJsonOutput(result.stdout);

	const unitIds = payload.units.map((entry) => entry.unit.id);
	assert.ok(unitIds.includes('api'));
	assert.ok(unitIds.includes('public-treedx-node-01'));
});

test('hosting apply waits for selected Railway deployments before live verification', () => {
	const source = readFileSync(resolve(import.meta.dirname, '..', 'src', 'cli', 'handlers', 'hosting.ts'), 'utf8');
	const waitIndex = source.indexOf('waitForRailwayManagedDeploymentsSettled');
	const liveIndex = source.indexOf('const liveHostedServices = environment');

	assert.notEqual(waitIndex, -1);
	assert.notEqual(liveIndex, -1);
	assert.ok(waitIndex < liveIndex);
	assert.match(source, /selectedRailwayServiceNames/u);
	assert.match(source, /timeoutMs: 600_000/u);
	assert.match(source, /Railway deployments did not settle before live verification/u);
});
