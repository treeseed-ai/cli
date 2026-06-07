import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeWorkspaceRoot } from './cli-test-fixtures.mjs';

const { runTreeseedCli } = await import('../dist/cli/main.js');

function makeMarketWorkspace() {
	const root = makeWorkspaceRoot();
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.ai
contactEmail: hello@treeseed.email
hosting:
  kind: market_control_plane
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
      projectName: treeseed-market
      serviceName: treeseed-market-api
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:api
  marketDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: treeseed-market-postgres
  marketOperationsRunner:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      serviceName: treeseed-market-operations-runner
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
smtp:
  enabled: true
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
	return { exitCode, stdout };
}

function parseJsonOutput(stdout) {
	const start = stdout.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${stdout}`);
	return JSON.parse(stdout.slice(start));
}

test('hosting plan emits placement-first JSON for staging', async () => {
	const cwd = makeMarketWorkspace();
	const result = await runCli(['hosting', 'plan', '--environment', 'staging', '--json'], cwd);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.stdout);

	assert.equal(payload.environment, 'staging');
	assert.ok(payload.placements.some((placement) => placement.placement === 'knowledge-library'));
	assert.ok(payload.units.some((entry) =>
		entry.unit.id === 'public-treedx-node'
		&& entry.unit.hostId === 'railway'
		&& entry.unit.projectGroupId === 'public-treedx-federation'));
});

test('hosting apply is dry-run by default', async () => {
	const cwd = makeMarketWorkspace();
	const result = await runCli(['hosting', 'apply', '--environment', 'staging', '--json'], cwd);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.stdout);

	assert.equal(payload.dryRun, true);
	assert.ok(payload.results.length > 0);
	assert.equal(payload.results.every((entry) => entry.verification.verified), true);
});

test('hosting plan can target API service only', async () => {
	const cwd = makeMarketWorkspace();
	const result = await runCli(['hosting', 'plan', '--environment', 'staging', '--service', 'api', '--json'], cwd);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.stdout);

	assert.deepEqual(payload.units.map((entry) => entry.unit.id), ['api']);
	assert.equal(payload.units[0].unit.config.rootDir, 'packages/api');
});
