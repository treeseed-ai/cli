import { spawnSync } from 'node:child_process';
import { corePackageRoot } from './package-tools.ts';
import { fixtureRoot } from './paths.ts';
import { prepareCloudflareLocalRuntime, startWranglerDev } from './local-dev-lib.ts';
import {
	clearStagedBuildOutput,
	createWatchBuildPaths,
	createTenantWatchEntries,
	startPollingWatch,
	stopManagedProcess,
	swapStagedBuildOutput,
	writeDevReloadStamp,
	workspaceSdkRoot,
} from './watch-dev-lib.ts';

const cliArgs = process.argv.slice(2);
const watchMode = cliArgs.includes('--watch');
const wranglerArgs = cliArgs.filter((arg) => arg !== '--watch');

let wranglerChild = null;
let stopWatching = null;
let isStoppingForRebuild = false;
let shuttingDown = false;

function runStep(command, args, { cwd = corePackageRoot, env = {}, fatal = true } = {}) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		cwd,
		env: { ...process.env, ...env },
	});

	if (result.status !== 0 && fatal) {
		process.exit(result.status ?? 1);
	}

	return result.status === 0;
}

function runFixtureBuildCycle({ includePackageBuild = false, includeSdkBuild = false, fatal = true, stagedOutput = false } = {}) {
	if (includeSdkBuild) {
		const sdkRoot = workspaceSdkRoot();
		if (sdkRoot) {
			const built = runStep('npm', ['run', 'build:dist'], { cwd: sdkRoot, fatal });
			if (!built) {
				return false;
			}
		}
	}

	if (includePackageBuild) {
		const built = runStep('npm', ['run', 'build:dist'], { cwd: corePackageRoot, fatal });
		if (!built) {
			return false;
		}
	}

	if (watchMode) {
		writeDevReloadStamp(fixtureRoot);
	}

	try {
		const outDir = stagedOutput ? createWatchBuildPaths(fixtureRoot).stagedDistRoot : undefined;
		if (stagedOutput) {
			clearStagedBuildOutput(fixtureRoot);
		}

		prepareCloudflareLocalRuntime({
			envOverrides: watchMode ? { TREESEED_PUBLIC_DEV_WATCH_RELOAD: 'true' } : {},
			outDir,
		});

		if (stagedOutput) {
			swapStagedBuildOutput(fixtureRoot);
		}

		return true;
	} catch (error) {
		if (fatal) {
			throw error;
		}
		console.error(error instanceof Error ? error.message : String(error));
		return false;
	}
}

function startWrangler() {
	const child = startWranglerDev(wranglerArgs, {
		env: watchMode ? { TREESEED_PUBLIC_DEV_WATCH_RELOAD: 'true' } : {},
		detached: process.platform !== 'win32',
	});

	wranglerChild = child;
	child.on('exit', (code, signal) => {
		if (child !== wranglerChild) {
			return;
		}

		wranglerChild = null;

		if (isStoppingForRebuild || shuttingDown) {
			return;
		}

		if (stopWatching) {
			stopWatching();
		}

		if (signal) {
			process.kill(process.pid, signal);
			return;
		}

		process.exit(code ?? 0);
	});
}

async function shutdownAndExit(code = 0) {
	shuttingDown = true;
	if (stopWatching) {
		stopWatching();
	}
	await stopManagedProcess(wranglerChild);
	process.exit(code);
}

process.on('SIGINT', () => {
	void shutdownAndExit(130);
});

process.on('SIGTERM', () => {
	void shutdownAndExit(143);
});

runFixtureBuildCycle({ includeSdkBuild: true, includePackageBuild: true, fatal: true });
startWrangler();

if (watchMode) {
	console.log('Starting fixture watch mode. Changes will rebuild the package fixture and refresh the browser.');
	stopWatching = startPollingWatch({
		watchEntries: createTenantWatchEntries(fixtureRoot),
		onChange: async ({ changedPaths, packageChanged, sdkChanged }) => {
			console.log(
				`Detected ${changedPaths.length} change${changedPaths.length === 1 ? '' : 's'}; rebuilding ${sdkChanged ? 'sdk, core, and fixture' : packageChanged ? 'core and fixture' : 'fixture'} output...`,
			);

			isStoppingForRebuild = true;
			await stopManagedProcess(wranglerChild);
			isStoppingForRebuild = false;

			const ok = runFixtureBuildCycle({
				includeSdkBuild: sdkChanged,
				includePackageBuild: packageChanged || sdkChanged,
				fatal: false,
				stagedOutput: false,
			});

			if (ok) {
				startWrangler();
				console.log('Rebuild complete. Wrangler restarted with the updated fixture output.');
			} else {
				console.error('Rebuild failed. Wrangler remains stopped until the next successful save.');
			}
		},
	});
}
