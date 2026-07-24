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

test('seed validates the canonical treeseed manifest', async () => {
	const root = seedWorkspace({ localService: false });
	const result = await runCli(['seed', 'treeseed', '--validate'], { cwd: root });
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Seed treeseed is valid/);
});

test('seed local plan prints deterministic human output', async () => {
	const root = seedWorkspace();
	const result = await runCli(['seed', 'treeseed', '--environments', 'local', '--plan'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: tempD1Path() },
	});
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Seed: treeseed/);
	assert.match(result.stdout, /Environments: local/);
	assert.match(result.stdout, /CREATE team TreeSeed/);
	assert.match(result.stdout, /CREATE project treeseed\/market/);
	assert.doesNotMatch(result.stdout, /capacity provider|capacity grant/u);
	assert.doesNotMatch(result.stdout, /work policy/u);
	assert.match(result.stdout, /CREATE repository host github\/knowledge-coop/);
	assert.match(result.stdout, /CREATE product template\/treeseed-market/);
	assert.match(result.stdout, /CREATE catalog artifact treeseed\/market-template@1\.0\.0/);
	assert.match(result.stdout, /  create: 5/);
	assert.match(result.stdout, /  skipped: 0/);
	assert.doesNotMatch(result.stdout, /CREATE lane /);
	assert.doesNotMatch(result.stdout, /codex-production/);
});

test('seed local plan does not require a saved market session', async () => {
	const root = seedWorkspace();
	const result = await runCli(['seed', 'treeseed', '--environments', 'local', '--plan', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: tempD1Path() },
	});
	assert.equal(result.exitCode, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.seed, 'treeseed');
	assert.deepEqual(payload.environments, ['local']);
	assert.equal(payload.summary.create, 5);
	assert.equal(payload.summary.skip, 0);
});

test('seed prod plan excludes seeded providers and grants', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async () => jsonResponse(remoteSeedPayload({
		environments: ['prod'],
	})), () => runCli(['seed', 'treeseed', '--environments', 'prod', '--plan'], { cwd: root, env: remoteSeedEnv(root) }));
	assert.equal(result.exitCode, 0);
	assert.doesNotMatch(result.stdout, /CREATE capacity provider/);
	assert.doesNotMatch(result.stdout, /CREATE grant/);
	assert.doesNotMatch(result.stdout, /work policy/u);
	assert.match(result.stdout, /  create: 1/);
	assert.match(result.stdout, /  skipped: 1/);
	assert.doesNotMatch(result.stdout, /local-codex/);
});

test('seed staging plan excludes seeded providers and grants', async () => {
	const root = remoteSeedWorkspace();
	const result = await withMockFetch(async () => jsonResponse(remoteSeedPayload()), () => runCli(['seed', 'treeseed', '--environments', 'staging', '--plan'], { cwd: root, env: remoteSeedEnv(root) }));
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Environments: staging/);
	assert.doesNotMatch(result.stdout, /CREATE capacity provider/);
	assert.doesNotMatch(result.stdout, /CREATE grant/);
	assert.doesNotMatch(result.stdout, /work policy/u);
	assert.match(result.stdout, /  create: 1/);
	assert.match(result.stdout, /  skipped: 1/);
	assert.doesNotMatch(result.stdout, /local-codex/);
});

test('seed json output includes canonical resources for agent review', async () => {
	const root = seedWorkspace();
	prepareLocalMarketSession(root);
	const result = await runCli(['seed', 'treeseed', '--environments', 'local', '--plan', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: tempD1Path() },
	});
	assert.equal(result.exitCode, 0);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.seed, 'treeseed');
	assert.deepEqual(payload.environments, ['local']);
	assert.equal(payload.summary.create, 5);
	assert.equal(payload.summary.skip, 0);
	assert.equal(payload.actions.filter((action) => action.action === 'skip').length, 0);
	assert.equal(payload.actions[0].key, 'team:treeseed');
});

test('seed local apply creates resources and repeated apply reports unchanged', async () => {
	const root = seedWorkspace();
	prepareLocalMarketSession(root);
	const persistTo = tempD1Path();
	const first = await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	assert.equal(first.exitCode, 0, first.stderr);
	const firstPayload = JSON.parse(first.stdout);
	assert.equal(firstPayload.ok, true);
	assert.equal(firstPayload.summary.create, 5);
	assert.equal(firstPayload.summary.skip, 0);
	assert.equal(firstPayload.result.actionCount, 5);

	const second = await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	assert.equal(second.exitCode, 0, second.stderr);
	const secondPayload = JSON.parse(second.stdout);
	assert.equal(secondPayload.summary.create, 0);
	assert.equal(secondPayload.summary.unchanged, 5);
	assert.equal(secondPayload.summary.skip, 0);
	assert.equal(secondPayload.result.actionCount, 0);
	assert.equal(secondPayload.actions.find((action) => action.key === 'team:treeseed').action, 'unchanged');
});

test('seed local apply can bootstrap without a saved market session', async () => {
	const root = seedWorkspace();
	const result = await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: tempD1Path() },
	});
	assert.equal(result.exitCode, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.result.message, 'Local seed apply completed.');
	assert.equal(payload.summary.create, 5);
	assert.equal(payload.result.actionCount, 5);
});

test('seed export emits a productized manifest from local state', async () => {
	const root = seedWorkspace();
	prepareLocalMarketSession(root);
	const persistTo = tempD1Path();
	await runCli(['seed', 'treeseed', '--environments', 'local', '--apply', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
	});
	const result = await runCli(['seed', 'export', 'treeseed', '--team', 'treeseed', '--include-artifacts', '--json'], {
		cwd: root,
		env: { ...remoteSeedEnv(root), TREESEED_API_D1_LOCAL_PERSIST_TO: persistTo },
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
