import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTests(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) return collectTests(path);
		return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

const tests = collectTests(resolve(process.cwd(), 'tests')).sort();
if (!tests.length) throw new Error('No CLI tests were discovered under tests/.');

const concurrency = Math.max(1, Number(process.env.TREESEED_CLI_TEST_CONCURRENCY ?? 2) || 2);
const result = spawnSync(process.execPath, [
	'--import',
	'tsx',
	'--test',
	`--test-concurrency=${concurrency}`,
	...tests,
], {
	cwd: process.cwd(),
	env: process.env,
	stdio: 'inherit',
});

process.exit(result.status ?? 1);
