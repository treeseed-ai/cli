import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { makeWorkspaceRoot } from './cli-test-fixtures.mjs';
import { setMarketSession } from '@treeseed/sdk/market-client';

const { runTreeseedCli } = await import('../dist/cli/main.js');

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..', '..', '..');

function tempD1Path() {
	return mkdtempSync(resolve(tmpdir(), 'treeseed-seed-d1-'));
}

async function runCli(args, options = {}) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
		cwd: options.cwd ?? process.cwd(),
		env: {
			...process.env,
			NODE_ENV: 'test',
			TREESEED_KEY_AGENT_TRANSPORT: 'inline',
			CI: undefined,
			ACT: undefined,
			GITHUB_ACTIONS: undefined,
			TREESEED_VERIFY_DRIVER: undefined,
			...(options.env ?? {}),
		},
		interactiveUi: false,
		write(output, stream) {
			writes.push({ output, stream });
		},
		spawn() {
			return { status: 0 };
		},
	});
	return {
		exitCode,
		writes,
		stdout: writes.filter((entry) => entry.stream === 'stdout').map((entry) => entry.output).join('\n'),
		stderr: writes.filter((entry) => entry.stream === 'stderr').map((entry) => entry.output).join('\n'),
		output: writes.map((entry) => entry.output).join('\n'),
	};
}

function writeSeed(root, name, yaml) {
	mkdirSync(resolve(root, 'seeds'), { recursive: true });
	writeFileSync(resolve(root, 'seeds', `${name}.yaml`), yaml, 'utf8');
}

function remoteSeedWorkspace() {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'treeseed', readFileSync(resolve(repoRoot, 'seeds', 'treeseed.yaml'), 'utf8'));
	setMarketSession(root, {
		marketId: 'central',
		accessToken: 'test-token',
		principal: {
			id: 'user-1',
			displayName: 'Seed User',
			scopes: ['auth:me', 'market'],
			roles: ['platform_admin'],
			permissions: ['*:*:*'],
		},
	});
	return root;
}

async function withMockFetch(handler, action) {
	const previous = globalThis.fetch;
	globalThis.fetch = handler;
	try {
		return await action();
	} finally {
		globalThis.fetch = previous;
	}
}

function jsonResponse(payload, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function remoteSeedPayload({ mode = 'plan', environments = ['staging'], summary = { create: 11, update: 0, unchanged: 0, skip: 11, delete: 0, error: 0 }, result = undefined } = {}) {
	return {
		ok: true,
		seed: 'treeseed',
		mode,
		environments,
		summary,
		actions: [
			{ action: 'create', kind: 'team', key: 'team:treeseed', label: 'TreeSeed', environments, payload: {} },
			{ action: 'create', kind: 'capacityProvider', key: 'capacity-provider:treeseed/production', label: 'treeseed-production', environments, payload: {} },
			{ action: 'create', kind: 'workPolicy', key: `work-policy:treeseed/${environments[0]}/market`, label: `market/${environments[0]}`, environments, payload: {} },
		],
		diagnostics: [],
		run: { id: 'seed-run-1', state: result?.blocked ? 'blocked' : 'completed', mode, seedName: 'treeseed' },
		...(result ? { result } : {}),
	};
}

const VALID_MINIMAL_SEED = `
name: demo
version: 1
defaultEnvironments: [local]
environments: [local, prod]
resources:
  teams:
    - key: team:demo
      slug: demo
      name: demo
  projects:
    - key: project:demo/site
      team: team:demo
      slug: site
      name: Demo Site
      repository:
        role: primary
        provider: github
        owner: treeseed-ai
        name: market
        gitUrl: https://github.com/treeseed-ai/market.git
        defaultBranch: main
  capacityProviders: []
  capacityGrants: []
  workPolicies: []
`;

test('seed validates the canonical treeseed manifest', async () => {
	const result = await runCli(['seed', 'treeseed', '--validate'], { cwd: repoRoot });
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Seed treeseed is valid/);
});

test('seed local plan prints deterministic human output', async () => {
	const result = await runCli(['seed', 'treeseed', '--environments', 'local', '--plan'], {
		cwd: repoRoot,
		env: { TREESEED_API_D1_LOCAL_PERSIST_TO: tempD1Path() },
	});
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Seed: treeseed/);
	assert.match(result.stdout, /Environments: local/);
	assert.match(result.stdout, /CREATE team TreeSeed/);
	assert.match(result.stdout, /CREATE project treeseed\/market/);
	assert.match(result.stdout, /CREATE capacity provider treeseed-local-dev/);
	assert.match(result.stdout, /CREATE lane local-codex/);
	assert.match(result.stdout, /CREATE grant treeseed\/local-dev -> treeseed/);
	assert.match(result.stdout, /CREATE work policy market\/local/);
	assert.match(result.stdout, /CREATE repository host github\/treeseed-ai/);
	assert.match(result.stdout, /CREATE product template\/treeseed-market/);
	assert.match(result.stdout, /CREATE catalog artifact treeseed\/market-template@1\.0\.0/);
	assert.match(result.stdout, /  create: 14/);
	assert.match(result.stdout, /  skipped: 11/);
	assert.doesNotMatch(result.stdout, /codex-production/);
});

test('seed prod plan includes production resources', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async () => jsonResponse(remoteSeedPayload({
		environments: ['prod'],
		summary: { create: 15, update: 0, unchanged: 0, skip: 7, delete: 0, error: 0 },
	})), () => runCli(['seed', 'treeseed', '--environments', 'prod', '--plan'], { cwd: root }));
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /CREATE capacity provider treeseed-production/);
	assert.match(result.stdout, /CREATE work policy market\/prod/);
	assert.match(result.stdout, /  create: 15/);
	assert.match(result.stdout, /  skipped: 7/);
	assert.doesNotMatch(result.stdout, /local-codex/);
});

test('seed staging plan includes staging capacity and work policy resources', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async () => jsonResponse(remoteSeedPayload()), () => runCli(['seed', 'treeseed', '--environments', 'staging', '--plan'], { cwd: root }));
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Environments: staging/);
	assert.match(result.stdout, /CREATE capacity provider treeseed-production/);
	assert.match(result.stdout, /CREATE work policy market\/staging/);
	assert.match(result.stdout, /  create: 11/);
	assert.match(result.stdout, /  skipped: 11/);
	assert.doesNotMatch(result.stdout, /local-codex/);
});

test('seed json output includes skipped resources for agent review', async () => {
	const result = await runCli(['seed', 'treeseed', '--environments', 'local', '--plan', '--json'], {
		cwd: repoRoot,
		env: { TREESEED_API_D1_LOCAL_PERSIST_TO: tempD1Path() },
	});
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.seed, 'treeseed');
	assert.deepEqual(payload.environments, ['local']);
	assert.equal(payload.summary.create, 14);
	assert.equal(payload.summary.skip, 11);
	assert.equal(payload.actions.filter((action) => action.action === 'skip').length, 11);
	assert.equal(payload.actions[0].key, 'team:treeseed');
});

test('seed local apply creates resources and repeated apply reports unchanged', async () => {
	const persistTo = tempD1Path();
	const first = await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: repoRoot,
		env: { TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	assert.equal(first.exitCode, 0, first.stderr);
	const firstPayload = JSON.parse(first.stdout);
	assert.equal(firstPayload.ok, true);
	assert.equal(firstPayload.summary.create, 14);
	assert.equal(firstPayload.summary.skip, 11);
	assert.equal(firstPayload.result.actionCount, 14);

	const second = await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: repoRoot,
		env: { TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	assert.equal(second.exitCode, 0, second.stderr);
	const secondPayload = JSON.parse(second.stdout);
	assert.equal(secondPayload.summary.create, 0);
	assert.equal(secondPayload.summary.unchanged, 14);
	assert.equal(secondPayload.summary.skip, 11);
	assert.equal(secondPayload.result.actionCount, 0);
	assert.equal(secondPayload.actions.find((action) => action.key === 'team:treeseed').action, 'unchanged');
});

test('seed export emits a productized manifest from local state', async () => {
	const persistTo = tempD1Path();
	await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: repoRoot,
		env: { TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	const result = await runCli(['seed', 'export', 'treeseed', '--team', 'treeseed', '--include-artifacts', '--json'], {
		cwd: repoRoot,
		env: { TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	assert.equal(result.exitCode, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.seed, 'treeseed');
	assert.match(payload.yaml, /repositoryHosts:/);
	assert.match(payload.yaml, /products:/);
	assert.match(payload.yaml, /catalogArtifacts:/);
	assert.doesNotMatch(payload.yaml, /encryptedPayload|BEGIN PRIVATE KEY|ghp_/);
});

test('seed staging apply uses the remote market API', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async (_url, init) => {
		assert.equal(init?.method, 'POST');
		assert.match(String(_url), /\/v1\/seeds\/treeseed\/apply$/);
		return jsonResponse(remoteSeedPayload({
			mode: 'apply',
			environments: ['staging'],
			result: { appliedAt: '2026-01-01T00:00:00.000Z', manifestHash: 'abc', actionCount: 11 },
		}));
	}, () => runCli(['seed', 'treeseed', '--environments', 'staging', '--apply', '--json'], { cwd: root }));
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.result.actionCount, 11);
});

test('seed prod apply returns blocked approval response', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async () => jsonResponse({
		...remoteSeedPayload({
			mode: 'apply',
			environments: ['prod'],
			summary: { create: 15, update: 0, unchanged: 0, skip: 7, delete: 0, error: 0 },
			result: {
				blocked: true,
				reason: 'Production seed apply requires approval.',
				approvalRequest: { id: 'approval-1', state: 'pending' },
				actionCount: 0,
			},
		}),
		ok: false,
		error: 'Production seed apply requires approval.',
	}, 409), () => runCli(['seed', 'treeseed', '--environments', 'prod', '--apply', '--json'], { cwd: root }));
	assert.equal(result.exitCode, 2);
	const payload = JSON.parse(result.stderr);
	assert.equal(payload.ok, false);
	assert.equal(payload.result.approvalRequest.id, 'approval-1');
});

test('seed prod apply passes approved approval request to remote market API', async () => {
	const root = remoteSeedWorkspace();
	let requestBody = null;
	const result = await withMockFetch(async (_url, init) => {
		requestBody = JSON.parse(String(init?.body ?? '{}'));
		return jsonResponse(remoteSeedPayload({
			mode: 'apply',
			environments: ['prod'],
			summary: { create: 15, update: 0, unchanged: 0, skip: 7, delete: 0, error: 0 },
			result: { appliedAt: '2026-01-01T00:00:00.000Z', manifestHash: 'abc', actionCount: 15 },
		}));
	}, () => runCli(['seed', 'treeseed', '--environments', 'prod', '--apply', '--approval-request', 'approval-1', '--json'], { cwd: root }));
	assert.equal(result.exitCode, 0);
	assert.deepEqual(requestBody.environments, ['prod']);
	assert.equal(requestBody.approvalRequestId, 'approval-1');
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.result.actionCount, 15);
});

test('seed remote auth failures map to exit code four', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'treeseed', readFileSync(resolve(repoRoot, 'seeds', 'treeseed.yaml'), 'utf8'));
	const result = await runCli(['seed', 'treeseed', '--environments', 'staging', '--plan', '--json'], { cwd: root });
	assert.equal(result.exitCode, 4);
	const payload = JSON.parse(result.stderr);
	assert.equal(payload.ok, false);
});

test('seed validation rejects duplicate keys', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('      name: demo', `      name: demo\n    - key: team:demo\n      slug: other\n      name: other`));
	const result = await runCli(['seed', 'demo', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /seed\.duplicate_key/);
});

test('seed validation rejects missing remote git url', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('        gitUrl: https://github.com/treeseed-ai/market.git\n', ''));
	const result = await runCli(['seed', 'demo', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /repository\.gitUrl/);
});

test('seed validation rejects repository owner and url mismatch', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('https://github.com/treeseed-ai/market.git', 'https://github.com/example/market.git'));
	const result = await runCli(['seed', 'demo', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /seed\.repository_metadata_mismatch/);
});

test('seed validation rejects invalid references', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('team: team:demo', 'team: team:missing'));
	const result = await runCli(['seed', 'demo', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /seed\.invalid_reference/);
});

test('seed validation rejects secret-looking values', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('resources:', 'token: ghp_1234567890abcdefghijklmnopqrstuvwxyz\nresources:'));
	const result = await runCli(['seed', 'demo', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /seed\.secret_/);
});
