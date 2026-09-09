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

test('healthy exact managed snapshot is reusable; missing runtime requires startup', () => {
    const state = JSON.stringify({ Name: 'treeseed-dev-test-api-operations-runner', State: 'running', Health: 'healthy' });
    assert.equal(managedContainerAlreadyReady({ registered: true, state }, 'dev-test', 'operations-runner'), true);
    assert.equal(managedContainerAlreadyReady({ registered: false, state: null }, 'dev-test', 'operations-runner'), false);
});

test('registered unhealthy, malformed, or wrong-instance state never authorizes overwrite', () => {
    const value = { Name: 'treeseed-dev-test-api-operations-runner', State: 'running', Health: 'unhealthy' };
    assert.throws(() => managedContainerAlreadyReady({ registered: true, state: JSON.stringify(value) }, 'dev-test', 'operations-runner'), /dev restart/);
    value.Health = 'healthy'; value.Name = 'unrelated';
    assert.throws(() => managedContainerAlreadyReady({ registered: true, state: JSON.stringify(value) }, 'dev-test', 'operations-runner'), /identity/);
    for (const state of ['', 'not json', '{}\n{}']) assert.throws(() => managedContainerAlreadyReady({ registered: true, state }, 'dev-test', 'service'));
});
