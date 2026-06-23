import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cliExports from '../dist/cli/main.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('cli package exposes its own runtime entrypoints', () => {
	assert.equal(typeof cliExports.runTreeseedCli, 'function');
	assert.equal(typeof cliExports.executeTreeseedCommand, 'function');
	assert.equal(typeof cliExports.renderTreeseedHelp, 'function');
	assert.equal(typeof cliExports.findCommandSpec, 'function');
});

test('published dist contains the cli runtime surface', () => {
	const distRoot = resolve(packageRoot, 'dist');
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
		'cli/help-ui.js',
		'cli/parser.js',
		'cli/registry.js',
		'cli/handlers/status.js',
		'index.js',
	]) {
		assert.ok(actualFiles.includes(requiredFile), `${requiredFile} should be published`);
	}
});

test('package bin exports both treeseed and trsd', () => {
	const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
	assert.deepEqual(packageJson.bin, {
		treeseed: './dist/cli/main.js',
		trsd: './dist/cli/main.js',
	});
});
