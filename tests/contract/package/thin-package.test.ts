import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('package has one executable and no runtime package dependency', () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.deepEqual(pkg.bin, { trsd: './dist/cli/main.js' });
	assert.equal(pkg.exports, undefined);
	assert.equal(pkg.types, undefined);
	assert.equal(pkg.dependencies['@treeseed/agent'], undefined);
	assert.equal(pkg.dependencies.ink, undefined);
	assert.equal(pkg.dependencies.react, undefined);
});

test('source contains no legacy implementation residue', () => {
	const walk = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${root}/${entry.name}`) : [`${root}/${entry.name}`]);
	const files = walk('src').join('\n');
	for (const forbidden of ['handlers/capacity', 'workspace-lifecycle', 'handlers/hosting', 'handlers/treedx', 'handlers/scenes', 'handlers/seeds', 'handlers/agents']) assert.equal(files.includes(forbidden), false, forbidden);
});
