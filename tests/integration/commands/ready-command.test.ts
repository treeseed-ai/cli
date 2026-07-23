import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeWorkspaceRoot } from '../../support/cli-test-fixtures.ts';

const { runTreeseedCli } = await import('../../../dist/cli/main.js');

function makeMarketWorkspace(rootDir = 'packages/api') {
	const root = makeWorkspaceRoot();
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.dev
contactEmail: hello@treeseed.ai
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
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
      rootDir: ${rootDir}
      buildCommand: npm run build
      startCommand: npm run start:api
      healthcheckPath: /healthz
  operationsRunner:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-ops-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      healthcheckPath: /healthz
      runtimeMode: service
      volumeMountPath: /data
      volumeName: treeseed-ops-01-volume
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets:
        - api
        - operationsRunner
`, 'utf8');
	mkdirSync(resolve(root, 'src'), { recursive: true });
	writeFileSync(resolve(root, 'src', 'env.yaml'), `entries:
  TREESEED_WEB_SERVICE_SECRET:
    label: API service caller secret
    group: auth
    description: Shared secret used by trusted web clients to authenticate internal calls to the Treeseed API.
    howToGet: Generate a strong random secret and configure the same value on callers and the API service.
    sensitivity: secret
    targets:
      - local-runtime
      - railway-secret
      - github-secret
      - cloudflare-secret
    appTargets:
      - api
    serviceTargets:
      - api
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: required
    purposes:
      - dev
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    defaultValueRef: generatedSecret
    localDefaultValueRef: generatedSecret
    relevanceRef: apiSurfaceEnabled
`, 'utf8');
	return root;
}

async function runCli(args, cwd) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
		cwd,
		env: { ...process.env, GITHUB_ACTIONS: undefined, CI: undefined },
		interactiveUi: false,
	write(output, stream) {
			writes.push({ output, stream });
		},
		spawn() {
			return { status: 0 };
		},
	});
	const output = writes.map((entry) => entry.output).join('\n');
	return { exitCode, output };
}

function parseJsonOutput(output) {
	const start = output.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${output}`);
	return JSON.parse(output.slice(start));
}

test('ready local reports deployment readiness', async () => {
	const result = await runCli(['ready', 'local', '--json'], makeMarketWorkspace());
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.environment, 'local');
	assert.equal(payload.deploymentReadiness.ok, true);
});

test('ready local fails on effective API root drift', async () => {
	const result = await runCli(['ready', 'local', '--json'], makeMarketWorkspace('.'));
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.deploymentReadiness.ok, false);
	assert.ok(payload.deploymentReadiness.checks.some((check) => check.id === 'hosting:api:rootDir' && check.status === 'failed'));
});
