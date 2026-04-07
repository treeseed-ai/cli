#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runTreeseedCli } from './runtime.js';

export { runTreeseedCli, executeTreeseedCommand, createTreeseedCommandContext } from './runtime.js';
export { renderTreeseedHelp, renderUsage, suggestTreeseedCommands } from './help.js';
export { findCommandSpec, listCommandNames, TRESEED_COMMAND_SPECS } from './registry.js';
export { parseTreeseedInvocation, validateTreeseedInvocation } from './parser.js';
export type {
	TreeseedCommandContext,
	TreeseedCommandResult,
	TreeseedCommandSpec,
	TreeseedParsedInvocation,
} from './types.js';

const currentFile = fileURLToPath(import.meta.url);
const entryFile = resolve(process.argv[1] ?? '');

if (entryFile === currentFile) {
	const exitCode = await runTreeseedCli(process.argv.slice(2));
	process.exit(exitCode);
}
