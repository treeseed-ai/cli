import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('package has one executable and no runtime package dependency', () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.deepEqual(pkg.bin, { trsd: './dist/cli/main.js' });
	assert.equal(pkg.exports, undefined);
	assert.equal(pkg.types, undefined);
	assert.equal(pkg.files.some((path: string) => path.startsWith('scripts/')), false);
	assert.equal(pkg.dependencies['@treeseed/agent'], undefined);
	assert.equal(pkg.dependencies.ink, undefined);
	assert.equal(pkg.dependencies.react, undefined);
	assert.deepEqual(pkg.dependencies, { '@treeseed/sdk': '0.13.0-rc.22', yaml: '2.8.1' });
});

test('built package contains executable runtime only', () => {
	assert.equal(existsSync('dist/cli/main.js'), true);
	assert.equal(existsSync('dist/cli/types.js'), false);
	assert.equal(readdirSync('dist', { recursive: true }).some((path) => String(path).endsWith('.d.ts')), false);
});

test('source contains no legacy implementation residue', () => {
	const walk = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${root}/${entry.name}`) : [`${root}/${entry.name}`]);
	const files = walk('src').join('\n');
	for (const forbidden of ['handlers/capacity', 'workspace-lifecycle', 'handlers/hosting', 'handlers/treedx', 'handlers/scenes', 'handlers/seeds', 'handlers/agents']) assert.equal(files.includes(forbidden), false, forbidden);
	const source = walk('src').map((file) => readFileSync(file, 'utf8')).join('\n');
	for (const forbidden of ['MarketClient', 'marketId', '--market', '/v1/', 'operator/commands', 'workflow-support']) assert.equal(source.includes(forbidden), false, forbidden);
	for (const removed of ['docs/src', 'guarantees', '.gitmodules']) assert.equal(existsSync(removed), false, removed);
});
