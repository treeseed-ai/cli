import { spawnSync } from 'node:child_process';
import { corePackageRoot, fixtureRoot } from './paths.ts';

const [command, ...rest] = process.argv.slice(2);

if (!command) {
	console.error('Usage: node ./scripts/run-fixture-astro-command.mjs <check|build|preview|dev> [...args]');
	process.exit(1);
}

const result = spawnSync('npx', ['astro', command, '--root', fixtureRoot, ...rest], {
	cwd: corePackageRoot,
	stdio: 'inherit',
	env: process.env,
	shell: process.platform === 'win32',
});

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
