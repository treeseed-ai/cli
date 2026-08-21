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
const globalStateTests = new Set([
	resolve(process.cwd(), 'tests/integration/commands/operations/human-command-interface.test.ts'),
	resolve(process.cwd(), 'tests/unit/runtime/market-mode.test.ts'),
]);

function run(selectedTests: string[], selectedConcurrency: number) {
	if (!selectedTests.length) return 0;
	const result = spawnSync(process.execPath, [
		'--import',
		'tsx',
		'--test',
		`--test-concurrency=${selectedConcurrency}`,
		...selectedTests,
	], {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

const parallelStatus = run(tests.filter((path) => !globalStateTests.has(path)), concurrency);
if (parallelStatus !== 0) process.exit(parallelStatus);

// These tests temporarily replace process-global fetch. Run them together in a
// serial phase so their restoration cannot race another file in the same VM.
process.exit(run(tests.filter((path) => globalStateTests.has(path)), 1));
