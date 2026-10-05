import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostDependencyRoots } from '../../../../src/cli/commands/development-support/host-dependencies.ts';

test('host custody includes nested production dependencies but not development-only packages', () => {
	const root = mkdtempSync(join(tmpdir(), 'host-closure-'));
	const pkg = (path: string, data: unknown) => { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'package.json'), JSON.stringify(data)); };
	try {
		pkg(root, { dependencies: { pg: '1' }, devDependencies: { tooling: '1' }, treeseed: { hostRuntimeDependencies: ['pg'] } });
		pkg(join(root, 'node_modules/pg'), { dependencies: { protocol: '1' }, optionalDependencies: { optional: '1' } });
		pkg(join(root, 'node_modules/pg/node_modules/protocol'), {});
		pkg(join(root, 'node_modules/tooling'), {});
		assert.deepEqual(hostDependencyRoots(root), [join(root, 'node_modules/pg'), join(root, 'node_modules/pg/node_modules/protocol')]);
		rmSync(join(root, 'node_modules/pg/node_modules/protocol'), { recursive: true });
		assert.throws(() => hostDependencyRoots(root), /missing: protocol/);
		symlinkSync(join(root, 'node_modules/tooling'), join(root, 'node_modules/pg/node_modules/protocol'));
		assert.throws(() => hostDependencyRoots(root), /symbolic link/);
	} finally { rmSync(root, { recursive: true }); }
});

test('host custody accepts a complete local package generation while resolving its closure from the host worktree', () => {
	const root = mkdtempSync(join(tmpdir(), 'host-overlay-'));
	const pkg = (path: string, data: unknown) => { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'package.json'), JSON.stringify(data)); };
	try {
		pkg(root, { dependencies: { '@treeseed/sdk': '1' }, treeseed: { hostRuntimeDependencies: ['@treeseed/sdk'] } });
		const generation = join(root, 'sdk/.treeseed/cache/development-sessions/dev-test/package/generation-1');
		pkg(generation, { name: '@treeseed/sdk', dependencies: { zod: '1' } });
		mkdirSync(join(generation, 'dist')); writeFileSync(join(generation, 'dist/.treeseed-build-complete.json'), '{}');
		pkg(join(root, 'node_modules/zod'), { name: 'zod' });
		mkdirSync(join(root, 'node_modules/@treeseed'), { recursive: true });
		symlinkSync(generation, join(root, 'node_modules/@treeseed/sdk'));
		assert.deepEqual(hostDependencyRoots(root), [join(root, 'node_modules/@treeseed/sdk'), join(root, 'node_modules/zod')]);
		rmSync(join(generation, 'dist/.treeseed-build-complete.json'));
		assert.throws(() => hostDependencyRoots(root), /symbolic link/);
	} finally { rmSync(root, { recursive: true }); }
});
