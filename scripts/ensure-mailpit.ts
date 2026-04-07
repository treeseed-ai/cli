import { spawnSync } from 'node:child_process';
import { dockerIsAvailable, findRunningMailpitContainer } from './mailpit-runtime.ts';
import { mailpitComposeFile, packageRoot } from './paths.ts';

if (!dockerIsAvailable()) {
	console.error('Docker is required for Treeseed form email testing. Start Docker and rerun the Mailpit command.');
	process.exit(1);
}

const existingMailpit = findRunningMailpitContainer();
if (existingMailpit) {
	console.log(`Reusing existing Mailpit container "${existingMailpit.name}" on ports 1025 and 8025.`);
	process.exit(0);
}

const result = spawnSync('docker', ['compose', '-f', mailpitComposeFile, 'up', '-d', 'mailpit'], {
	encoding: 'utf8',
	cwd: packageRoot,
	env: { ...process.env },
});

if (result.status !== 0) {
	const reusedMailpit = findRunningMailpitContainer();
	if (reusedMailpit) {
		console.log(`Reusing existing Mailpit container "${reusedMailpit.name}" on ports 1025 and 8025.`);
		process.exit(0);
	}

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
}

process.exit(result.status ?? 1);
