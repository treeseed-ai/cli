import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { corePackageRoot, sdkPackageRoot } from './package-tools.ts';

const WATCH_INTERVAL_MS = 900;
const DEBOUNCE_MS = 350;
const DEV_RELOAD_FILE = 'public/__treeseed/dev-reload.json';
const PROCESS_SHUTDOWN_TIMEOUT_MS = 5000;
const WATCH_BUILD_ROOT = '.local/treeseed-watch';
const PROCESS_SETTLE_DELAY_MS = 300;

function isNodeModulesPath(filePath) {
	return filePath.split(sep).includes('node_modules');
}

export function isEditablePackageWorkspace() {
	return !isNodeModulesPath(corePackageRoot);
}

export function workspaceSdkRoot() {
	return existsSync(resolve(sdkPackageRoot, 'package.json')) ? sdkPackageRoot : null;
}

export function writeDevReloadStamp(projectRoot) {
	const outputPath = resolve(projectRoot, DEV_RELOAD_FILE);
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(
		outputPath,
		`${JSON.stringify(
			{
				buildId: `${Date.now()}`,
				updatedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		'utf8',
	);
}

function shouldIgnoreWatchPath(filePath, rootPath) {
	const rel = relative(rootPath, filePath);
	if (!rel || rel.startsWith(`..${sep}`) || rel === '..') {
		return false;
	}

	const normalized = rel.split(sep).join('/');
	return (
		normalized === '.git' ||
		normalized.startsWith('.git/') ||
		normalized === 'node_modules' ||
		normalized.startsWith('node_modules/') ||
		normalized === '.astro' ||
		normalized.startsWith('.astro/') ||
		normalized === '.wrangler' ||
		normalized.startsWith('.wrangler/') ||
		normalized === '.local' ||
		normalized.startsWith('.local/') ||
		normalized === '.treeseed' ||
		normalized.startsWith('.treeseed/') ||
		normalized === 'dist' ||
		normalized.startsWith('dist/') ||
		normalized === 'coverage' ||
		normalized.startsWith('coverage/') ||
		normalized === '.dev.vars' ||
		normalized === 'books' ||
		normalized.startsWith('books/') ||
		normalized === '__treeseed' ||
		normalized.startsWith('__treeseed/') ||
		normalized.startsWith('public/books/') ||
		normalized.startsWith('public/__treeseed/')
	);
}

function collectRootSnapshot(rootPath, snapshot) {
	if (!existsSync(rootPath)) {
		return;
	}

	const rootStats = statSync(rootPath);
	if (rootStats.isFile()) {
		snapshot.set(rootPath, `${rootStats.mtimeMs}:${rootStats.size}`);
		return;
	}

	for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
		const fullPath = resolve(rootPath, entry.name);
		if (shouldIgnoreWatchPath(fullPath, rootPath)) {
			continue;
		}

		if (entry.isDirectory()) {
			collectDirectorySnapshot(fullPath, rootPath, snapshot);
			continue;
		}

		const stats = statSync(fullPath);
		snapshot.set(fullPath, `${stats.mtimeMs}:${stats.size}`);
	}
}

function collectDirectorySnapshot(directoryPath, rootPath, snapshot) {
	if (shouldIgnoreWatchPath(directoryPath, rootPath)) {
		return;
	}

	for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
		const fullPath = resolve(directoryPath, entry.name);
		if (shouldIgnoreWatchPath(fullPath, rootPath)) {
			continue;
		}

		if (entry.isDirectory()) {
			collectDirectorySnapshot(fullPath, rootPath, snapshot);
			continue;
		}

		const stats = statSync(fullPath);
		snapshot.set(fullPath, `${stats.mtimeMs}:${stats.size}`);
	}
}

function collectSnapshot(entries) {
	const snapshot = new Map();
	for (const entry of entries) {
		collectRootSnapshot(entry.root, snapshot);
	}
	return snapshot;
}

function diffSnapshots(previousSnapshot, nextSnapshot) {
	const changed = new Set();

	for (const [filePath, signature] of nextSnapshot.entries()) {
		if (previousSnapshot.get(filePath) !== signature) {
			changed.add(filePath);
		}
	}

	for (const filePath of previousSnapshot.keys()) {
		if (!nextSnapshot.has(filePath)) {
			changed.add(filePath);
		}
	}

	return [...changed];
}

function classifyChanges(changedPaths, watchEntries) {
	function matchesEntry(filePath, entry) {
		return filePath === entry.root || filePath.startsWith(`${entry.root}${sep}`);
	}

	return {
		changedPaths,
		sdkChanged: changedPaths.some((filePath) =>
			watchEntries.some((entry) => entry.kind === 'sdk' && matchesEntry(filePath, entry)),
		),
		packageChanged: changedPaths.some((filePath) =>
			watchEntries.some((entry) => entry.kind === 'package' && matchesEntry(filePath, entry)),
		),
		tenantChanged: changedPaths.some((filePath) =>
			watchEntries.some((entry) => entry.kind === 'tenant' && matchesEntry(filePath, entry)),
		),
	};
}

export function readDevReloadState(projectRoot) {
	const filePath = resolve(projectRoot, DEV_RELOAD_FILE);
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

export function createTenantWatchEntries(tenantRoot) {
	const entries = [
		{ kind: 'tenant', root: resolve(tenantRoot, 'src') },
		{ kind: 'tenant', root: resolve(tenantRoot, 'public') },
		{ kind: 'tenant', root: resolve(tenantRoot, 'astro.config.ts') },
		{ kind: 'tenant', root: resolve(tenantRoot, 'treeseed.site.yaml') },
		{ kind: 'tenant', root: resolve(tenantRoot, '.env.local') },
		{ kind: 'tenant', root: resolve(tenantRoot, '.env.local.example') },
	];

	if (isEditablePackageWorkspace()) {
		const sdkRoot = workspaceSdkRoot();
		entries.push(
			{ kind: 'package', root: resolve(corePackageRoot, 'src') },
			{ kind: 'package', root: resolve(corePackageRoot, 'scripts') },
			{ kind: 'package', root: resolve(corePackageRoot, 'services') },
			{ kind: 'package', root: resolve(corePackageRoot, 'tsconfigs') },
			{ kind: 'package', root: resolve(corePackageRoot, 'package.json') },
		);
		if (sdkRoot) {
			entries.push(
				{ kind: 'sdk', root: resolve(sdkRoot, 'src') },
				{ kind: 'sdk', root: resolve(sdkRoot, 'scripts') },
				{ kind: 'sdk', root: resolve(sdkRoot, 'package.json') },
			);
		}
	}

	return entries;
}

export function startPollingWatch({ watchEntries, onChange }) {
	let previousSnapshot = collectSnapshot(watchEntries);
	let queuedPaths = [];
	let debounceTimer = null;
	let running = false;
	let intervalId = null;

	async function flush() {
		if (running || queuedPaths.length === 0) {
			return;
		}

		const changedPaths = [...new Set(queuedPaths)];
		queuedPaths = [];
		running = true;

		try {
			await onChange(classifyChanges(changedPaths, watchEntries));
		} finally {
			running = false;
			if (queuedPaths.length > 0) {
				debounceTimer = setTimeout(flush, DEBOUNCE_MS);
			}
		}
	}

	function queueChanges(changedPaths) {
		if (changedPaths.length === 0) {
			return;
		}

		queuedPaths.push(...changedPaths);
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(flush, DEBOUNCE_MS);
	}

	intervalId = setInterval(() => {
		const nextSnapshot = collectSnapshot(watchEntries);
		const changedPaths = diffSnapshots(previousSnapshot, nextSnapshot);
		previousSnapshot = nextSnapshot;
		queueChanges(changedPaths);
	}, WATCH_INTERVAL_MS);

	return () => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		if (intervalId) {
			clearInterval(intervalId);
		}
	};
}

export async function stopManagedProcess(child, signal = 'SIGTERM') {
	if (!child || child.exitCode !== null || child.killed) {
		return;
	}

	const groupSignalSupported = process.platform !== 'win32' && child.pid && child.spawnargs;
	let signaled = false;
	if (groupSignalSupported) {
		try {
			process.kill(-child.pid, signal);
			signaled = true;
		} catch {
			signaled = false;
		}
	}

	if (!signaled) {
		child.kill(signal);
	}

	await Promise.race([
		new Promise((resolve) => child.once('exit', resolve)),
		delay(PROCESS_SHUTDOWN_TIMEOUT_MS),
	]);

	if (child.exitCode === null && !child.killed) {
		if (groupSignalSupported) {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {
				child.kill('SIGKILL');
			}
		} else {
			child.kill('SIGKILL');
		}

		await Promise.race([
			new Promise((resolve) => child.once('exit', resolve)),
			delay(PROCESS_SHUTDOWN_TIMEOUT_MS),
		]);
	}

	await delay(PROCESS_SETTLE_DELAY_MS);
}

export function createWatchBuildPaths(projectRoot) {
	const watchRoot = resolve(projectRoot, WATCH_BUILD_ROOT);
	return {
		watchRoot,
		stagedDistRoot: resolve(watchRoot, 'dist-next'),
		backupDistRoot: resolve(watchRoot, 'dist-prev'),
		liveDistRoot: resolve(projectRoot, 'dist'),
	};
}

export function swapStagedBuildOutput(projectRoot) {
	const { watchRoot, stagedDistRoot, backupDistRoot, liveDistRoot } = createWatchBuildPaths(projectRoot);
	mkdirSync(watchRoot, { recursive: true });
	rmSync(backupDistRoot, { recursive: true, force: true });

	if (existsSync(liveDistRoot)) {
		try {
			renameSync(liveDistRoot, backupDistRoot);
		} catch {
			// Some rebuild cycles leave the previous backup path occupied long enough that the
			// rename can fail. In that case, drop the old live output and replace it directly.
			rmSync(liveDistRoot, { recursive: true, force: true });
		}
	}

	renameSync(stagedDistRoot, liveDistRoot);
	rmSync(backupDistRoot, { recursive: true, force: true });
}

export function clearStagedBuildOutput(projectRoot) {
	const { stagedDistRoot } = createWatchBuildPaths(projectRoot);
	rmSync(stagedDistRoot, { recursive: true, force: true });
}
