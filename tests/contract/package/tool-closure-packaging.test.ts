import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { stagePackageForToolClosure } from '../../../scripts/packages/pack-tool-closure.ts';

function writeJson(path: string, value: Record<string, unknown>) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('tool closure staging does not mutate workspace-linked source manifests', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-tool-closure-test-'));
	try {
		const source = resolve(root, 'workspace/core');
		const installed = resolve(root, 'node_modules/@treeseed/core');
		const destination = resolve(root, 'staging/core');
		const sourceManifestPath = resolve(source, 'package.json');
		writeJson(sourceManifestPath, {
			name: '@treeseed/core',
			version: '1.2.3',
			dependencies: {
				'@treeseed/sdk': 'github:treeseed-ai/sdk#exact-commit',
			},
		});
		mkdirSync(dirname(installed), { recursive: true });
		symlinkSync(source, installed, 'dir');
		const originalManifest = readFileSync(sourceManifestPath, 'utf8');

		stagePackageForToolClosure(installed, destination, new Map([
			['@treeseed/sdk', '4.5.6'],
		]));

		assert.equal(lstatSync(destination).isSymbolicLink(), false);
		assert.equal(existsSync(resolve(destination, 'package.json')), true);
		assert.equal(readFileSync(sourceManifestPath, 'utf8'), originalManifest);
		assert.deepEqual(JSON.parse(readFileSync(resolve(destination, 'package.json'), 'utf8')), {
			name: '@treeseed/core',
			version: '1.2.3',
			dependencies: {
				'@treeseed/sdk': '4.5.6',
			},
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
