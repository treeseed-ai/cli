import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { readPostgresTransferSelection } from '../../../../src/cli/commands/host/postgres-transfer.ts';

const selection = { componentId: 'api', sourceRuntimeDigest: `sha256:${'a'.repeat(64)}`, targetRuntimeDigest: `sha256:${'b'.repeat(64)}`,
  topologyDigest: `sha256:${'c'.repeat(64)}`, configurationDigest: `sha256:${'d'.repeat(64)}`, allowLocaleConversion: false };
test('plan, prepare and status use the normal manager contract without file paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-postgres-')), file = join(root, 'selection.json');
  try {
    writeFileSync(file, JSON.stringify(selection), { mode: 0o600 });
    for (const plan of [true, false]) {
      const calls: unknown[] = [];
      assert.equal(await runCommandLine(['host', 'postgres', 'transfer', 'prepare', file, plan ? '--plan' : '--yes', '--json'], {
        interactiveUi: false, hostInvoke: async input => { calls.push(input); return { action: plan ? 'planned' : 'prepared', selectionDigest: selection.topologyDigest }; }, write() {},
      }), 0);
      assert.deepEqual(calls, [{ handlerId: 'local.host.postgres.transfer.prepare', arguments: [],
        options: { ...(plan ? { plan: true } : {}), payload: JSON.stringify(selection) } }]);
    }
    const calls: unknown[] = [];
    assert.equal(await runCommandLine(['host', 'postgres', 'transfer', 'status', '--json'], {
      interactiveUi: false, hostInvoke: async input => { calls.push(input); return null; }, write() {},
    }), 0);
    assert.deepEqual(calls, [{ handlerId: 'local.host.postgres.transfer.status', arguments: [], options: {} }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('unsafe or invalid files fail without exposing selected contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-postgres-')), file = join(root, 'selection.json');
  try {
    for (const value of ['synthetic-secret', JSON.stringify({ ...selection, password: 'synthetic-secret' }), 'x'.repeat(16_385)]) {
      writeFileSync(file, value);
      assert.throws(() => readPostgresTransferSelection(file), error => error instanceof Error && !error.message.includes('synthetic-secret'));
    }
    writeFileSync(file, JSON.stringify(selection)); symlinkSync(file, join(root, 'link'));
    assert.throws(() => readPostgresTransferSelection(join(root, 'link')));
    assert.throws(() => readPostgresTransferSelection(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
