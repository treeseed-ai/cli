import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('complete CLI source is readable owner files without undeclared external Git links', () => {
	const result = spawnSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const entries = result.stdout.split('\0').filter(Boolean);
	assert.ok(entries.length > 0);
	for (const entry of entries) {
		const tab = entry.indexOf('\t');
		assert.ok(tab > 0);
		const mode = entry.slice(0, 6), path = entry.slice(tab + 1);
		assert.ok(['100644', '100755', '120000'].includes(mode), `Unowned source entry: ${path} (${mode})`);
		assert.doesNotThrow(() => readFileSync(path), `Unreadable source entry: ${path}`);
	}
});
