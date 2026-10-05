import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Reporting may observe the complete suite, never alter its selection. */
export function reportingArguments(args: readonly string[]): string[] {
	if (!args.length) return [];
	const values = new Map<string,string>();
	for (const arg of args) {
		const match = /^(--test-reporter|--test-reporter-destination)=(.+)$/u.exec(arg);
		if (!match || !match[2]!.trim() || values.has(match[1]!)) throw new Error('Native reporting requires one nonempty reporter and destination; test selection arguments are prohibited.');
		values.set(match[1]!,match[2]!);
	}
	if (values.size !== 2) throw new Error('Native reporting requires both reporter and destination.');
	return [...values].map(([key,value])=>`${key}=${value}`);
}

function collectTests(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) return collectTests(path);
		return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

function main(): void {
	const reporting = reportingArguments(process.argv.slice(2));
	const tests = collectTests(resolve(process.cwd(), 'tests')).sort();
	if (!tests.length) throw new Error('No CLI tests were discovered under tests/.');

	const concurrency = Math.max(1, Number(process.env.TREESEED_CLI_TEST_CONCURRENCY ?? 2) || 2);
	const result = spawnSync(process.execPath, [
		'--import',
		'tsx',
		'--test',
		`--test-concurrency=${concurrency}`,
		...reporting,
		...tests,
	], {
		cwd: process.cwd(),
		env: {...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS ?? ''} --import=${resolve(process.cwd(),'tests/support/os-custody.mjs')}`.trim()},
		stdio: 'inherit',
	});

	process.exit(result.status ?? 1);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
