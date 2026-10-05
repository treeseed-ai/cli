import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, watchFile, unwatchFile } from 'node:fs';
import { resolve } from 'node:path';

const roots = new Set(['team', 'chat', 'inbox', 'discover']);
const requestedRoot = process.env.TREESEED_UI_WORKSPACE ?? process.argv[2] ?? 'team';
if (!roots.has(requestedRoot)) throw new Error(`TREESEED_UI_WORKSPACE must be one of ${[...roots].join(', ')}.`);
const requestedSurface = process.env.TREESEED_UI_SURFACE ?? process.argv[3];
const executable = resolve('dist/cli/main.js');
const markers = [resolve('dist/.treeseed-build-complete.json'), resolve('../ui/dist/.treeseed-build-complete.json')];
let child: ChildProcess | undefined;
let restartTimer: NodeJS.Timeout | undefined;
let stopping = false;

function argumentsForScene() {
	const args = [executable, requestedRoot === 'team' ? 'ui' : requestedRoot];
	if (requestedSurface) args.push('--surface', requestedSurface);
	return args;
}

function start() {
	if (stopping) return;
	if (!existsSync(executable)) throw new Error('CLI output is unavailable. Start the CLI package development target first.');
	child = spawn(process.execPath, argumentsForScene(), { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
	child.once('exit', (code, signal) => {
		child = undefined;
		if (!stopping && code && !signal) process.stderr.write(`trsd development UI exited with code ${code}; waiting for the next build.\n`);
	});
}

function restart() {
	if (restartTimer) clearTimeout(restartTimer);
	restartTimer = setTimeout(() => {
		const previous = child;
		if (!previous) return start();
		previous.once('exit', start);
		previous.kill('SIGTERM');
	}, 180);
}

function stop(signal: NodeJS.Signals) {
	stopping = true;
	if (restartTimer) clearTimeout(restartTimer);
	for (const marker of markers) unwatchFile(marker);
	if (child) child.kill(signal);
}

for (const marker of markers) watchFile(marker, { interval: 250 }, (current, prior) => {
	if (current.mtimeMs && current.mtimeMs !== prior.mtimeMs) restart();
});
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
process.stdout.write(`Watching local CLI and UI builds; reopening ${requestedRoot}${requestedSurface ? ` / ${requestedSurface}` : ''}.\n`);
start();
