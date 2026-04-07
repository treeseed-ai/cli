#!/usr/bin/env node

import { runTreeseedCli } from '../src/cli/main.ts';

const exitCode = await runTreeseedCli(process.argv.slice(2));
process.exit(exitCode);
