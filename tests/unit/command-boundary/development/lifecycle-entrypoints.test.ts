import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { resumeDevelopmentSession, runDevelopment } from '../../../../src/cli/commands/development.ts';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import type { CommandContext, ParsedInvocation } from '../../../../src/cli/types.ts';

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
