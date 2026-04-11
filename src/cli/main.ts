#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runTreeseedCli } from './runtime.js';

export * from './runtime.js';
export * from './help.js';
export * from './parser.js';
export * from './registry.js';
export type * from './types.js';

function resolveExecutablePath(path: string) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

const currentFile = resolveExecutablePath(fileURLToPath(import.meta.url));
const entryFile = resolveExecutablePath(process.argv[1] ?? '');

if (entryFile === currentFile) {
	const exitCode = await runTreeseedCli(process.argv.slice(2));
	process.exit(exitCode);
}
