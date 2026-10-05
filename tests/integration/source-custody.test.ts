import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import test from 'node:test';

test('fresh native Git checkout materializes every CLI source entry without missing-directory sentinels', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'cli-source-checkout-'));
	try {
		const list = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
		assert.equal(list.status, 0, list.stderr);
		const files = list.stdout.split('\0').filter(Boolean);
		assert.ok(files.length > 0);
		const checkout = spawnSync('git', ['checkout-index', '--all', `--prefix=${root}${sep}`], { encoding: 'utf8' });
		assert.equal(checkout.status, 0, checkout.stderr);
		for (const path of files) {
			const target = resolve(root, path);
			assert.ok(target.startsWith(`${root}${sep}`), path);
			assert.doesNotThrow(() => readFileSync(target), `Checkout lacks readable source: ${path}`);
			assert.deepEqual(readFileSync(target), readFileSync(path), `Checkout bytes differ: ${path}`);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});
