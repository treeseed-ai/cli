import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import * as cliExports from '../dist/cli/main.js';

test('cli package exposes its own runtime entrypoints', () => {
	assert.equal(typeof cliExports.runTreeseedCli, 'function');
	assert.equal(typeof cliExports.executeTreeseedCommand, 'function');
	assert.equal(typeof cliExports.renderTreeseedHelp, 'function');
	assert.equal(typeof cliExports.findCommandSpec, 'function');
});

test('published dist contains the cli runtime surface', () => {
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

	for (const requiredFile of [
		'cli/main.js',
		'cli/runtime.js',
		'cli/help.js',
		'cli/parser.js',
		'cli/registry.js',
		'cli/handlers/status.js',
		'index.js',
	]) {
		assert.ok(actualFiles.includes(requiredFile), `${requiredFile} should be published`);
	}
});
