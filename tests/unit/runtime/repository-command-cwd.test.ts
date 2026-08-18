import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { findOperation } from '../../../src/cli/operations/operations-registry.ts';
import { resolveCommandCwd } from '../../../src/cli/runtime/runtime.ts';

test('save preserves the invoking nested repository while workspace commands use the project root', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-repository-command-cwd-'));
	try {
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'name: Root\nslug: root\n');
		const nested = resolve(root, 'packages', 'sdk');
		mkdirSync(nested, { recursive: true });

		const save = findOperation('save');
		const status = findOperation('status');
		assert.ok(save);
		assert.ok(status);
		assert.equal(resolveCommandCwd(save, nested).cwd, nested);
		assert.equal(resolveCommandCwd(save, nested).resolvedProjectRoot, root);
		assert.equal(resolveCommandCwd(status, nested).cwd, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
