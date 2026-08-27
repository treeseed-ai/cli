import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../src/cli/runtime.ts';
import { developmentOperationEnvironment, relativeOverlayTarget, waitForNewPackageOverlay } from '../../../src/cli/commands/development.ts';

const manifest = `schemaVersion: treeseed.package/v1
development:
  schemaVersion: treeseed.development-runtime/v1
  project: { id: admin, repository: treeseed-ai/admin }
  defaults: { leaseSeconds: 3600, restoreOnFailure: true }
  targets:
    - id: web
      kind: live-web
      platforms: [linux-amd64]
      runtimeRequirements: [node>=22]
      sourceRoots: [src]
      ignoredPaths: [dist]
      operations:
        start: { command: npm, args: [run, dev], environment: {}, timeoutSeconds: 600 }
      ready: { kind: http, path: /healthz, expectedStatus: 200, timeoutSeconds: 30 }
      outputs: []
      endpoints:
        - { id: http, protocol: http, port: 4322, canonicalAlias: admin.treeseed.localhost, visibility: host, authentication: application }
      dependencies: []
      statePolicy: stateless
      migrationPolicy: none
      secretRefs: {}
      shutdown: { graceSeconds: 30, activeWorkPolicy: block }
      resources: {}
      logs: [.treeseed/dev/admin.log]
      forbiddenOperations: [manager-socket]
      promotion: { liveAdmissible: false, candidateRequiresVerification: true }
`;

test('development session planning records exact source without manager mutation', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-development-')), file = resolve(root, 'treeseed.package.yaml'), output: string[] = [];
	try {
		writeFileSync(file, manifest); execFileSync('git', ['init', '-b', 'staging'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
		execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], { cwd: root });
		let managerCalls = 0;
		const exit = await runCommandLine(['dev', 'session', 'start', file, '--actor', 'test-developer', '--lease-seconds', '600', '--plan', '--json'], { cwd: root, env: { XDG_STATE_HOME: resolve(root, 'state'), USER: 'tester' }, interactiveUi: false, hostInvoke: async () => { managerCalls += 1; }, write: (value) => output.push(value) });
		assert.equal(exit, 0); assert.equal(managerCalls, 0);
		const result = JSON.parse(output[0]!).result;
		assert.equal(result.mutation, false); assert.equal(result.session.actor, 'test-developer');
		assert.equal(result.session.repositories[0].dirty, false); assert.match(result.session.repositories[0].commit, /^[a-f0-9]{40}$/u);
		assert.equal(result.runtimes[0].targets[0].endpoints[0].canonicalAlias, 'admin.treeseed.localhost');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('development session start uses one protected manager command and private local custody', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-development-')), file = resolve(root, 'treeseed.package.yaml'), calls: unknown[] = [], output: string[] = [];
	try {
		writeFileSync(file, manifest); execFileSync('git', ['init', '-b', 'staging'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
		execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], { cwd: root });
		const exit = await runCommandLine(['dev', 'session', 'start', file, '--json'], { cwd: root, env: { XDG_STATE_HOME: resolve(root, 'state'), USER: 'tester' }, interactiveUi: false, hostInvoke: async (input) => { calls.push(input); return { session: { sessionId: 'accepted' } }; }, write: (value) => output.push(value) });
		assert.equal(exit, 0); assert.equal(calls.length, 1); assert.equal((calls[0] as { handlerId: string }).handlerId, 'local.dev.session.start');
		const payload = JSON.parse((calls[0] as { options: { payload: string } }).options.payload);
		assert.equal(payload.runtimes[0].project.id, 'admin'); assert.equal(payload.session.targets[0].mode, 'released');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('development operations receive portable workspace identity and overlays use relative links', () => {
	const state = { manifest: '/workspace/development.session.yaml', sessionId: 'session-1' };
	const environment = developmentOperationEnvironment(state, '/workspace/packages/api', 'live', { PATH: '/usr/bin' }, { TREESEED_API_BASE_URL: 'https://api.treeseed.localhost' });
	assert.equal(environment.TREESEED_DEVELOPMENT_WORKSPACE_ROOT, '/workspace');
	assert.equal(environment.TREESEED_DEVELOPMENT_WORKTREE, '/workspace/packages/api');
	assert.equal(environment.TREESEED_DEVELOPMENT_SESSION_ID, 'session-1');
	assert.equal(environment.TREESEED_API_BASE_URL, 'https://api.treeseed.localhost');
	const link = '/workspace/packages/api/node_modules/@treeseed/sdk';
	const overlay = '/workspace/packages/sdk/.treeseed/cache/development-sessions/session-1/package';
	const target = relativeOverlayTarget(link, overlay);
	assert.equal(target.startsWith('/'), false);
	assert.equal(resolve(resolve(link, '..'), target), resolve(overlay, 'current'));
});

test('package rebuild waits for a new marker-complete atomic generation', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-overlay-')), overlay = resolve(root, 'overlay');
	try {
		mkdirSync(resolve(overlay, 'generation-1'), { recursive: true });
		symlinkSync(resolve(overlay, 'generation-1'), resolve(overlay, 'current'));
		const target = { id: 'package', ready: { kind: 'marker', path: 'dist/.complete.json', timeoutSeconds: 2 } } as any;
		const waiting = waitForNewPackageOverlay(target, root, overlay, resolve(overlay, 'generation-1'));
		setTimeout(() => {
			mkdirSync(resolve(root, 'dist'), { recursive: true }); writeFileSync(resolve(root, 'dist/.complete.json'), '{}');
			mkdirSync(resolve(overlay, 'generation-2')); symlinkSync(resolve(overlay, 'generation-2'), resolve(overlay, '.next')); renameSync(resolve(overlay, '.next'), resolve(overlay, 'current'));
		}, 50);
		assert.equal(await waiting, resolve(overlay, 'generation-2'));
	} finally { rmSync(root, { recursive: true, force: true }); }
});
