import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(import.meta.dirname, '../..');
const outputRoot = resolve(packageRoot, process.env.TREESEED_TOOL_CLOSURE_OUTPUT?.trim() || 'artifacts');

mkdirSync(outputRoot, { recursive: true });
const packed = spawnSync('npm', [
	'pack',
	packageRoot,
	'--json',
	'--ignore-scripts',
	'--pack-destination',
	outputRoot,
], {
	cwd: packageRoot,
	encoding: 'utf8',
	stdio: 'pipe',
});

if (packed.status !== 0) {
	throw new Error(packed.stderr?.trim() || packed.stdout?.trim() || 'Unable to pack the CLI artifact.');
}

process.stdout.write(packed.stdout);
