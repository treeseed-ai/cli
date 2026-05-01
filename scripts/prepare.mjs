#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

if (process.env.CI === 'true' && process.env.TREESEED_RUN_PREPARE_IN_CI !== '1') {
	process.exit(0);
}

const result = spawnSync('npm', ['run', 'build:dist'], {
	stdio: 'inherit',
	shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
