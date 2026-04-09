import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import * as cliExports from '../dist/cli/main.js';
import * as sdkCliExports from '@treeseed/sdk/treeseed-cli';

test('cli package re-exports the sdk cli runtime', () => {
	assert.equal(cliExports.runTreeseedCli, sdkCliExports.runTreeseedCli);
	assert.equal(cliExports.executeTreeseedCommand, sdkCliExports.executeTreeseedCommand);
	assert.equal(cliExports.renderTreeseedHelp, sdkCliExports.renderTreeseedHelp);
	assert.equal(cliExports.findCommandSpec, sdkCliExports.findCommandSpec);
});

test('published dist contains only wrapper-facing entrypoints', () => {
	const distRoot = resolve(process.cwd(), 'dist');
	const actualFiles = [];
	const walk = (root) => {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			const fullPath = resolve(root, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			actualFiles.push(relative(distRoot, fullPath).replaceAll('\\', '/'));
		}
	};

	walk(distRoot);
	actualFiles.sort();

	assert.deepEqual(actualFiles, [
		'cli/help.d.ts',
		'cli/help.js',
		'cli/main.d.ts',
		'cli/main.js',
		'cli/parser.d.ts',
		'cli/parser.js',
		'cli/registry.d.ts',
		'cli/registry.js',
		'cli/runtime.d.ts',
		'cli/runtime.js',
		'cli/types.d.ts',
		'cli/types.js',
		'index.d.ts',
		'index.js',
	]);
});
