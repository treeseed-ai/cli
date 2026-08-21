#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommandLine } from './runtime.js';

const executable = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
if (executable(process.argv[1] ?? '') === executable(fileURLToPath(import.meta.url))) process.exit(await runCommandLine(process.argv.slice(2)));
