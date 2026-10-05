import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const marker = resolve('dist/.treeseed-build-complete.json');
const result = spawnSync('npm', ['run', 'build:dist'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
if (result.status !== 0) process.exitCode = result.status ?? 1;
else {
	mkdirSync(dirname(marker), { recursive: true });
	const temporary = `${marker}.new`;
	writeFileSync(temporary, `${JSON.stringify({ completedAt: new Date().toISOString(), executable: 'cli/main.js' })}\n`);
	renameSync(temporary, marker);
}
