#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommandLine } from './runtime/runtime.js';

export * from './runtime/runtime.js';
export * from './support/help.js';
export * from './support/parser.js';
export * from './support/registry.js';
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
	const exitCode = await runCommandLine(process.argv.slice(2));
	process.exit(exitCode);
}
