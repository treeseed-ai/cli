import test from 'node:test';
import assert from 'node:assert/strict';
import {
	CANONICAL_SEED,
	VALID_MINIMAL_SEED,
	jsonResponse,
	markerPath,
	makeWorkspaceRoot,
	prepareMarketSessionStorage,
	prepareLocalMarketSession,
	remoteSeedEnv,
	remoteSeedPayload,
	remoteSeedWorkspace,
	runCli,
	seedWorkspace,
	tempD1Path,
	withMockFetch,
	writeSeed,
} from '../../../support/seed-command-harness.ts';

test('seed staging apply uses the remote API', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async (_url, init) => {
		assert.equal(init?.method, 'POST');
		assert.match(String(_url), /\/v1\/seeds\/treeseed\/apply$/);
		return jsonResponse(remoteSeedPayload({
			mode: 'apply',
			environments: ['staging'],
			result: {
				appliedAt: '2026-01-01T00:00:00.000Z',
				manifestHash: 'abc',
				actionCount: 2,
			},
		}));
	}, () => runCli(['seed', 'treeseed', '--environments', 'staging', '--apply', '--json'], { cwd: root, env: remoteSeedEnv(root) }));
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.result.actionCount, 2);
});

test('seed prod apply returns blocked approval response', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async () => jsonResponse({
		...remoteSeedPayload({
			mode: 'apply',
			environments: ['prod'],
			result: {
				blocked: true,
				reason: 'Production seed apply requires approval.',
				approvalRequest: { id: 'approval-1', state: 'pending' },
				actionCount: 0,
			},
		}),
		ok: false,
		error: 'Production seed apply requires approval.',
	}, 409), () => runCli(['seed', 'treeseed', '--environments', 'prod', '--apply', '--json'], { cwd: root, env: remoteSeedEnv(root) }));
	assert.equal(result.exitCode, 2);
	const payload = JSON.parse(result.stderr);
	assert.equal(payload.ok, false);
	assert.equal(payload.result.approvalRequest.id, 'approval-1');
});

test('seed prod apply passes approved approval request to remote API', async () => {
	const root = remoteSeedWorkspace();
	let requestBody = null;
	const result = await withMockFetch(async (_url, init) => {
		requestBody = JSON.parse(String(init?.body ?? '{}'));
		return jsonResponse(remoteSeedPayload({
			mode: 'apply',
			environments: ['prod'],
			result: { appliedAt: '2026-01-01T00:00:00.000Z', manifestHash: 'abc', actionCount: 2 },
		}));
	}, () => runCli(['seed', 'treeseed', '--environments', 'prod', '--apply', '--approval-request', 'approval-1', '--json'], { cwd: root, env: remoteSeedEnv(root) }));
	assert.equal(result.exitCode, 0);
	assert.deepEqual(requestBody.environments, ['prod']);
	assert.equal(requestBody.approvalRequestId, 'approval-1');
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.result.actionCount, 2);
});

test('seed remote auth failures map to exit code four', async () => {
	const root = seedWorkspace({ localService: false });
	prepareMarketSessionStorage(root);
	const result = await runCli(['seed', 'treeseed', '--environments', 'staging', '--plan', '--json'], { cwd: root, env: remoteSeedEnv(root) });
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
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('        gitUrl: https://github.com/knowledge-coop/market.git\n', ''));
	const result = await runCli(['seed', 'demo', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /repository\.gitUrl/);
});

test('seed validation rejects repository owner and url mismatch', async () => {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'demo', VALID_MINIMAL_SEED.replace('https://github.com/knowledge-coop/market.git', 'https://github.com/example/market.git'));
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
