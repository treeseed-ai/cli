#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runTreeseedCli } from '@treeseed/sdk/treeseed-cli';

export * from '@treeseed/sdk/treeseed-cli';

const currentFile = fileURLToPath(import.meta.url);
const entryFile = resolve(process.argv[1] ?? '');

if (entryFile === currentFile) {
	const exitCode = await runTreeseedCli(process.argv.slice(2));
	process.exit(exitCode);
}
