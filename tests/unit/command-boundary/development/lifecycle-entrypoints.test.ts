import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { resumeDevelopmentSession, runDevelopment } from '../../../../src/cli/commands/development.ts';
import type { CommandContext, ParsedInvocation } from '../../../../src/cli/types.ts';

test('boot resume and manual use re-read state under the same lifecycle lock', { skip: process.platform !== 'linux' }, async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lifecycle-entry-'));
    const sessionId = 'dev-test', env = { ...process.env, XDG_STATE_HOME: root };
    const directory = resolve(root, 'treeseed/development');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(directory, 'current.json'), JSON.stringify({ sessionId, manifest: resolve(root, 'session.yaml'), processes: {}, overlays: [], candidates: [] }));
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
            const payload = JSON.parse(String(request.options.payload));
            if (request.handlerId === 'local.dev.status') return record;
            if (request.handlerId === 'local.dev.use') {
                assert.equal(payload.port, undefined, 'Manager-custody targets must not receive redundant host-port readiness probes');
                return record;
            }
            if (request.handlerId === 'local.dev.environment') return { environment: {} };
            if (request.handlerId === 'local.dev.container' && payload.action === 'status') return started
                ? { registered: true, state: JSON.stringify({ Name: 'treeseed-dev-test-api-operations-runner', State: 'running', Health: 'healthy' }) }
                : { registered: false, state: null };
            if (request.handlerId === 'local.dev.container' && payload.action === 'start') {
                starts++; await new Promise(resolve => setTimeout(resolve, 30)); started = true; return { started: true };
            }
            throw new Error(`Unexpected operation ${request.handlerId}`);
        },
    } as CommandContext;
    const invocation = { command: { name: 'dev use' }, arguments: ['api.operations-runner=candidate'], options: { session: sessionId } } as ParsedInvocation;
    try {
        await Promise.all([resumeDevelopmentSession(sessionId, context), runDevelopment(invocation, context)]);
        assert.equal(starts, 1);
        await resumeDevelopmentSession(sessionId, context);
        assert.equal(starts, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
