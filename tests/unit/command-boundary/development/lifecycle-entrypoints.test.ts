import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { resumeDevelopmentSession, runDevelopment } from '../../../../src/cli/commands/development.ts';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import type { CommandContext, ParsedInvocation } from '../../../../src/cli/types.ts';
import { parseInvocation } from '../../../../src/cli/parser.ts';
import { resolveCommand } from '../../../../src/cli/registry.ts';
import type { DevelopmentRuntime, DevelopmentTarget } from '@treeseed/sdk/development';
import { startPackageSynchronizer, stopProcess, waitForPackageOverlay } from '../../../../src/cli/commands/development-support/overlays.ts';
import { rebuildTarget } from '../../../support/development-rebuild.ts';

test('development freeze and verify planning returns exact nonmutating actions without manager dispatch', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'provider-plan-unit-'));
    const directory = resolve(root, 'treeseed/development'), sessionId = 'dev-unit';
    const state = { sessionId, manifest: resolve(root, 'manifest.yaml'), processes: {}, overlays: [], candidates: [] };
    mkdirSync(resolve(directory, sessionId), { recursive: true });
    const paths = [resolve(directory, 'current.json'), resolve(directory, sessionId, 'session.json')];
    for (const path of paths) writeFileSync(path, JSON.stringify(state));
    const before = paths.map(path => readFileSync(path));
    let dispatches = 0;
    const context: CommandContext = { cwd: root, env: { ...process.env, XDG_STATE_HOME: root },
        interactiveUi: false, outputFormat: 'json', write() {},
        hostInvoke: async () => { dispatches++; throw new Error('Planning dispatched a manager operation'); } };
    try {
        const outcomes = await Promise.allSettled(['freeze', 'verify'].map(action => {
            const selected = resolveCommand(['dev', action, '--plan', '--session', sessionId]);
            assert.ok(selected);
            return runDevelopment(parseInvocation(selected.command, selected.rest), context);
        }));
        assert.deepEqual(outcomes, ['freeze', 'verify'].map(action => ({ status: 'fulfilled',
            value: { sessionId, action, mutation: false } })));
        assert.equal(dispatches, 0);
        paths.forEach((path, index) => assert.deepEqual(readFileSync(path), before[index]));
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('boot resume and manual use re-read state under the same lifecycle lock', { skip: process.platform !== 'linux' }, async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lifecycle-entry-'));
    const sessionId = 'dev-test', env = { ...process.env, XDG_STATE_HOME: root };
    const directory = resolve(root, 'treeseed/development');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest = resolve(root, 'session.yaml');
    writeFileSync(manifest, `projects:\n  - manifest: api/treeseed.package.yaml\n    worktree: .\n`);
    mkdirSync(resolve(root, 'api'), { recursive: true, mode: 0o700 });
    writeFileSync(resolve(root, 'api/treeseed.package.yaml'), JSON.stringify({ development: {
        schemaVersion: 'treeseed.development-runtime/v2', project: { id: 'api', repository: 'treeseed-ai/api' }, defaults: { restoreOnFailure: true },
        targets: [{ id: 'operations-runner', kind: 'rebuild-restart', executionCustody: 'manager', platforms: ['linux-amd64'], runtimeRequirements: [],
            sourceRoots: ['src'], ignoredPaths: [], operations: { start: { command: 'manager-runtime' } }, ready: { kind: 'process', graceSeconds: 0 },
            outputs: [], endpoints: [{ id: 'http', protocol: 'http', port: 4000, visibility: 'loopback', authentication: 'application' }], dependencies: [],
            statePolicy: 'stateless', migrationPolicy: 'none', secretRefs: {}, shutdown: { graceSeconds: 1, activeWorkPolicy: 'block' }, resources: {}, logs: [],
            forbiddenOperations: [], promotion: { liveAdmissible: false, candidateRequiresVerification: true } }],
    } }));
    const local = { sessionId, manifest, processes: {}, overlays: [], candidates: [] };
    writeFileSync(resolve(directory, 'current.json'), JSON.stringify(local), { mode: 0o600 });
    mkdirSync(resolve(directory, sessionId), { mode: 0o700 });
    writeFileSync(resolve(directory, sessionId, 'session.json'), JSON.stringify(local), { mode: 0o600 });
    const record = {
        session: { sessionId, status: 'active', repositories: [{ projectId: 'api', worktree: root }],
            targets: [{ projectId: 'api', targetId: 'operations-runner', mode: 'candidate', generation: 0, health: 'pending' }] },
        runtimes: [{ project: { id: 'api' }, targets: [{ id: 'operations-runner', kind: 'rebuild-restart', executionCustody: 'manager',
            operations: { start: { command: 'manager-runtime' } }, dependencies: [], endpoints: [{ id: 'http', protocol: 'http', port: 4000 }], ready: { kind: 'process', graceSeconds: 0 } }] }],
    };
    let started = false, starts = 0;
    const context = {
        cwd: root, env,
        hostInvoke: async (request: { handlerId: string; options: { payload?: unknown } }) => {
            const payload = request.options.payload ? JSON.parse(String(request.options.payload)) : {};
            if (request.handlerId === 'local.dev.status') return payload.all ? { sessions: [record] } : record;
			if (request.handlerId === 'local.host.config.show') return { components: { api: { enabled: true } } };
            if (request.handlerId === 'local.dev.session.refresh') return record;
            if (request.handlerId === 'local.dev.use') {
                assert.equal(payload.port, undefined, 'Manager-custody targets must not receive redundant host-port readiness probes');
                record.session.status = 'active';
                return record;
            }
            if (request.handlerId === 'local.dev.environment') return { environment: {} };
            if (request.handlerId === 'local.dev.container' && payload.action === 'status') return started
                ? { registered: true, state: JSON.stringify({ Name: 'treeseed-dev-test-api-operations-runner', State: 'running', Health: 'healthy' }) }
                : { registered: false, state: null };
            if (request.handlerId === 'local.dev.container' && payload.action === 'start') {
                starts++; await new Promise(resolve => setTimeout(resolve, 30)); started = true; return { started: true };
            }
            if (request.handlerId === 'local.dev.container' && payload.action === 'stop') { started = false; return { stopped: true }; }
            if (request.handlerId === 'local.dev.session.suspend') { record.session.status = 'suspended'; return record; }
            if (request.handlerId === 'local.host.stop') return { state: 'stopped', changed: true };
            if (request.handlerId === 'local.host.start') return { state: 'running', changed: true };
            throw new Error(`Unexpected operation ${request.handlerId}`);
        },
    } as CommandContext;
    const invocation = { command: { name: 'dev use' }, arguments: ['api.operations-runner=candidate'], options: { session: sessionId } } as ParsedInvocation;
    try {
        await Promise.all([resumeDevelopmentSession(sessionId, context), runDevelopment(invocation, context)]);
        assert.equal(starts, 1);
        await resumeDevelopmentSession(sessionId, context);
        assert.equal(starts, 1);
        const lifecycleContext = { ...context, interactiveUi: false, write() {} };
        assert.equal(await runCommandLine(['host', 'stop', '--yes', '--json'], lifecycleContext), 0);
        assert.equal(record.session.status, 'suspended');
        assert.equal(started, false);
        assert.equal(await runCommandLine(['host', 'start', '--yes', '--json'], lifecycleContext), 0);
        assert.equal(starts, 2, 'Host start must restore the exact suspended live target');
        assert.equal(record.session.status, 'active');
        await resumeDevelopmentSession(sessionId, context);
        assert.equal(starts, 2, 'Repeating resume must not duplicate the managed container');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

function packageReleaseFixture() {
    const root = mkdtempSync(resolve(tmpdir(), 'package-release-')), sessionId = 'dev-test';
    const env = { ...process.env, XDG_STATE_HOME: root, NODE_OPTIONS: undefined }, manifest = resolve(root, 'treeseed.package.yaml');
    const target: DevelopmentTarget = { ...rebuildTarget(), id: 'package', kind: 'package-watch', operations: {},
        ready: { kind: 'marker', path: 'dist/.complete', timeoutSeconds: 10 },
        outputs: [{ path: 'dist', mediaType: 'application/javascript', digestAlgorithm: 'sha256' }] };
    const runtime: DevelopmentRuntime = { schemaVersion: 'treeseed.development-runtime/v2',
        project: { id: 'specimen', repository: 'example/specimen' }, defaults: { restoreOnFailure: true }, targets: [target] };
    writeFileSync(manifest, JSON.stringify({ development: runtime }));
    writeFileSync(resolve(root, 'package.json'), '{"name":"@test/specimen"}');
    mkdirSync(resolve(root, 'dist')); writeFileSync(resolve(root, 'dist/.complete'), '{"completedAt":"2026-10-08T00:00:00Z"}');
    writeFileSync(resolve(root, 'dist/candidate.js'), 'export const specimen = true;\n');
    const state: Parameters<typeof startPackageSynchronizer>[0] & { manifest: string; candidates: string[] } = {
        sessionId, manifest, processes: {}, overlays: [], candidates: [] };
    const directory = resolve(root, 'treeseed/development'), snapshot = resolve(directory, sessionId, 'session.json');
    mkdirSync(resolve(root, 'treeseed'), { mode: 0o700 }); mkdirSync(directory, { mode: 0o700 });
    const save = () => { mkdirSync(resolve(directory, sessionId), { recursive: true, mode: 0o700 });
        for (const path of [resolve(directory, 'current.json'), snapshot]) writeFileSync(path, JSON.stringify(state)); };
    const calls: string[] = [], output: string[] = [];
    const record = { session: { sessionId, status: 'active', repositories: [{ projectId: 'specimen', worktree: root }] }, runtimes: [runtime] };
    const context: CommandContext = { cwd: root, env, interactiveUi: false, outputFormat: 'json', write: value => output.push(value),
        hostInvoke: async request => { calls.push(request.handlerId);
            if (['local.dev.session.refresh', 'local.dev.status', 'local.dev.use'].includes(request.handlerId)) return record;
            throw new Error(`Unexpected package release operation ${request.handlerId}`); } };
    return { root, sessionId, env, state, runtime, target, snapshot, save, calls, output,
        release: () => runCommandLine(['dev', 'use', 'specimen.package=released', '--session', sessionId, '--json'], context),
        close: async () => { await stopProcess(state, 'overlay-sync.specimen.package');
            rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false); } };
}

test('package release drops only stale selected synchronizer custody without signaling an unowned process', async () => {
    const f = packageReleaseFixture();
    try {
        const unowned = { pid: process.pid, identity: 'not-the-current-process', projectId: 'specimen', targetId: 'package', log: resolve(f.root, 'unused.log') };
        const unrelated = { ...unowned, projectId: 'unrelated' };
        f.state.processes = { 'overlay-sync.specimen.package': unowned, 'unrelated.worker': unrelated }; f.save();
        assert.equal(await f.release(), 0, f.output.join(''));
        const saved: typeof f.state = JSON.parse(readFileSync(f.snapshot, 'utf8'));
        assert.deepEqual(saved.processes, { 'unrelated.worker': unrelated });
        assert.doesNotThrow(() => process.kill(process.pid, 0));
        assert.equal(f.calls.some(call => call === 'local.dev.container'), false);
    } finally { await f.close(); }
});

test('native public package release stops its owned synchronizer before removing generations and retains exact replay', async () => {
    const f = packageReleaseFixture();
    try {
        const overlay = startPackageSynchronizer(f.state, f.runtime, f.target, f.root, f.env);
        await waitForPackageOverlay(f.target, f.root, overlay);
        const entry = f.state.processes['overlay-sync.specimen.package']!;
        f.state.overlays = [{ projectId: 'specimen', packageName: '@test/specimen', link: resolve(f.root, 'unused-consumer'), backup: null, overlayRoot: overlay }];
        f.save(); const bytes = readFileSync(resolve(f.root, 'dist/candidate.js'));
        assert.equal(await f.release(), 0, f.output.join(''));
        assert.throws(() => process.kill(entry.pid, 0), { code: 'ESRCH' });
        const saved: typeof f.state = JSON.parse(readFileSync(f.snapshot, 'utf8'));
        assert.deepEqual(saved.processes, {}); assert.deepEqual(saved.overlays, []); assert.equal(existsSync(overlay), false);
        writeFileSync(resolve(f.root, 'dist/.complete'), '{"completedAt":"2026-10-08T00:00:01Z"}');
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(existsSync(overlay), false); assert.deepEqual(readFileSync(resolve(f.root, 'dist/candidate.js')), bytes);
        assert.equal(await f.release(), 0, f.output.join(''));
        assert.deepEqual(JSON.parse(readFileSync(f.snapshot, 'utf8')), saved);
    } finally { await f.close(); }
});
