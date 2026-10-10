#!/usr/bin/env node

import { runCommandLine } from './runtime.js';

process.exitCode = await runCommandLine(process.argv.slice(2));
