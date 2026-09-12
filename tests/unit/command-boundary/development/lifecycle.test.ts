import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { managedContainerAlreadyReady, withDevelopmentLifecycle } from '../../../../src/cli/commands/development-support/lifecycle.ts';

const worker = resolve(import.meta.dirname, '../../../support/lifecycle-worker.ts');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function child(root: string) {
    return fork(worker, [root], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
}
async function stop(process: ChildProcess) {
    if (process.exitCode !== null || process.signalCode !== null) return;
    const exited = once(process, 'exit'); process.kill('SIGKILL'); await exited;
}

test('Linux manual/resume processes serialize; killing owner releases the lock', { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lifecycle-'));
    const first = child(root); let second: ChildProcess | undefined;
    try {
        assert.equal((await once(first, 'message'))[0], 'entered');
        second = child(root);
        let entered = false;
        const ready = once(second, 'message').then(value => { entered = true; return value; });
        await delay(500); assert.equal(entered, false);
        await stop(first);
        assert.equal((await ready)[0], 'entered');
        const exited = once(second, 'exit'); second.send('release');
        assert.deepEqual(await exited, [0, null]);
        await withDevelopmentLifecycle({ XDG_STATE_HOME: root }, async () => {});
    } finally { await stop(first); if (second) await stop(second); rmSync(root, { recursive: true, force: true }); }
});

test('lifecycle lock releases after a failed operation', { skip: process.platform !== 'linux' }, async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lifecycle-'));
    try {
        await assert.rejects(withDevelopmentLifecycle({ XDG_STATE_HOME: root }, async () => { throw new Error('test failure'); }), /test failure/);
        assert.equal(await withDevelopmentLifecycle({ XDG_STATE_HOME: root }, async () => 'ready'), 'ready');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('boot acquisition survives a timeout window while manual acquisition stays bounded', { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lifecycle-boot-wait-'));
    const owner = child(root);
    const env = { XDG_STATE_HOME: root };
    let runs = 0;
    try {
        assert.equal((await once(owner, 'message'))[0], 'entered');
        const queued = withDevelopmentLifecycle(env, async () => { runs++; return 'ready'; }, { waitForOwner: true, lockTimeoutSeconds: 1 });
        await assert.rejects(withDevelopmentLifecycle(env, async () => assert.fail('manual entered'), { lockTimeoutSeconds: 1 }), /OS custody is busy/);
        await delay(300);
        assert.equal(runs, 0);
        const exited = once(owner, 'exit'); owner.send('release'); await exited;
        assert.equal(await queued, 'ready');
        assert.equal(runs, 1);
    } finally { await stop(owner); rmSync(root, { recursive: true, force: true }); }
});

test('boot waiting never replays action errors or retries invalid lock configuration', { skip: process.platform !== 'linux', timeout: 5000 }, async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lifecycle-no-replay-'));
    let runs = 0;
    try {
        await assert.rejects(withDevelopmentLifecycle({ XDG_STATE_HOME: root }, async () => {
            runs++; throw new Error('OS custody is busy; retry the operation');
        }, { waitForOwner: true }), /OS custody is busy/);
        assert.equal(runs, 1);
        await assert.rejects(withDevelopmentLifecycle({ XDG_STATE_HOME: root }, async () => assert.fail('entered'), {
            waitForOwner: true, lockTimeoutSeconds: 0,
        }), /Invalid custody lock timeout/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('healthy exact managed snapshot is reusable; missing runtime requires startup', () => {
    const state = JSON.stringify({ Name: 'treeseed-dev-test-api-operations-runner', State: 'running', Health: 'healthy' });
    assert.equal(managedContainerAlreadyReady({ registered: true, state }, 'dev-test', 'operations-runner'), true);
    assert.equal(managedContainerAlreadyReady({ registered: false, state: null }, 'dev-test', 'operations-runner'), false);
});

test('healthy multi-container manager runtime is reusable', () => {
	const instances = ['manager', 'runner'].map((name) => ({ name, sessionId: 'dev-test', target: 'agent.provider', running: true, health: 'healthy' }));
	assert.equal(managedContainerAlreadyReady({ registered: true, instances, ready: true }, 'dev-test', 'provider'), true);
	assert.equal(managedContainerAlreadyReady({ registered: true, instances: [{ ...instances[0], running: false }], ready: false }, 'dev-test', 'provider'), false);
});

test('registered unhealthy, malformed, or wrong-instance state never authorizes overwrite', () => {
    const value = { Name: 'treeseed-dev-test-api-operations-runner', State: 'running', Health: 'unhealthy' };
    assert.equal(managedContainerAlreadyReady({ registered: true, state: JSON.stringify(value) }, 'dev-test', 'operations-runner'), false);
    value.Health = 'healthy'; value.Name = 'unrelated';
    assert.throws(() => managedContainerAlreadyReady({ registered: true, state: JSON.stringify(value) }, 'dev-test', 'operations-runner'), /identity/);
    for (const state of ['', 'not json', '{}\n{}']) assert.throws(() => managedContainerAlreadyReady({ registered: true, state }, 'dev-test', 'service'));
});
