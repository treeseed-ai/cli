import { spawnSync } from 'node:child_process';
import { corePackageRoot, packageScriptPath, spawnNodeBinary, resolveWranglerBin } from './package-tools.ts';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from './config-runtime-lib.ts';
import { ensureGeneratedWranglerConfig } from './deploy-lib.ts';
import { loadTreeseedDeployConfig } from '@treeseed/core/deploy/config';
import {
	createTenantWatchEntries,
	isEditablePackageWorkspace,
	startPollingWatch,
	stopManagedProcess,
	writeDevReloadStamp,
	workspaceSdkRoot,
} from './watch-dev-lib.ts';

const tenantRoot = process.cwd();
const cliArgs = process.argv.slice(2);
const watchMode = cliArgs.includes('--watch');
const wranglerArgs = cliArgs.filter((arg) => arg !== '--watch');

let wranglerChild = null;
let stopWatching = null;
let isStoppingForRebuild = false;
let shuttingDown = false;

function shouldEnsureMailpit() {
	if (process.env.TREESEED_DEV_FORCE_MAILPIT === '1') {
		return true;
	}

	return loadTreeseedDeployConfig().smtp?.enabled === true;
}

function runStep(command, args, { cwd = tenantRoot, env = {}, fatal = true } = {}) {
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

function runNodeScript(scriptPath, args = [], options = {}) {
	return runStep(process.execPath, [scriptPath, ...args], options);
}

function runTenantBuildCycle({ includePackageBuild = false, includeSdkBuild = false, fatal = true } = {}) {
	const envOverrides = ['TREESEED_LOCAL_DEV_MODE=cloudflare'];
	if (watchMode) {
		envOverrides.push('TREESEED_PUBLIC_DEV_WATCH_RELOAD=true');
	}

	if (includeSdkBuild && isEditablePackageWorkspace()) {
		const sdkRoot = workspaceSdkRoot();
		if (sdkRoot) {
			const sdkBuilt = runStep('npm', ['run', 'build:dist'], {
				cwd: sdkRoot,
				fatal,
			});
			if (!sdkBuilt) {
				return false;
			}
		}
	}

	if (includePackageBuild && isEditablePackageWorkspace()) {
			const distBuilt = runStep('npm', ['run', 'build:dist'], {
				cwd: corePackageRoot,
				fatal,
			});
		if (!distBuilt) {
			return false;
		}
	}

	const buildScripts = [
		['patch-starlight-content-path', []],
		['aggregate-book', []],
		['sync-dev-vars', envOverrides],
		['tenant-d1-migrate-local', []],
	];

	if (shouldEnsureMailpit()) {
		buildScripts.splice(2, 0, ['ensure-mailpit', []]);
	}

	for (const [scriptName, args] of buildScripts) {
		const ok = runNodeScript(packageScriptPath(scriptName), args, { fatal });
		if (!ok) {
			return false;
		}
	}

	ensureGeneratedWranglerConfig(tenantRoot);

	if (watchMode) {
		writeDevReloadStamp(tenantRoot);
	}

	const built = runNodeScript(packageScriptPath('tenant-build'), [], {
		fatal,
		env: watchMode ? { TREESEED_PUBLIC_DEV_WATCH_RELOAD: 'true' } : {},
	});
	if (!built) {
		return false;
	}

	return true;
}

function startWrangler() {
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot);
	const child = spawnNodeBinary(
		resolveWranglerBin(),
		['dev', '--local', '--config', wranglerPath, ...wranglerArgs],
		{
			cwd: tenantRoot,
			env: watchMode ? { TREESEED_PUBLIC_DEV_WATCH_RELOAD: 'true' } : {},
			detached: process.platform !== 'win32',
		},
	);

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

async function restartWranglerAfterBuild() {
	if (wranglerChild) {
		isStoppingForRebuild = true;
		await stopManagedProcess(wranglerChild);
		isStoppingForRebuild = false;
	}

	if (!shuttingDown) {
		startWrangler();
	}
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

process.env.TREESEED_LOCAL_DEV_MODE = process.env.TREESEED_LOCAL_DEV_MODE ?? 'cloudflare';
applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local' });
assertTreeseedCommandEnvironment({ tenantRoot, scope: 'local', purpose: 'dev' });

runTenantBuildCycle({
	includeSdkBuild: isEditablePackageWorkspace(),
	includePackageBuild: isEditablePackageWorkspace(),
	fatal: true,
});

startWrangler();

if (watchMode) {
	console.log('Starting unified Wrangler watch mode. Changes will rebuild the app and refresh the browser.');
	stopWatching = startPollingWatch({
		watchEntries: createTenantWatchEntries(tenantRoot),
		onChange: async ({ changedPaths, packageChanged, sdkChanged }) => {
			console.log(
				`Detected ${changedPaths.length} change${changedPaths.length === 1 ? '' : 's'}; rebuilding ${sdkChanged ? 'sdk, core, and tenant' : packageChanged ? 'core and tenant' : 'tenant'} output...`,
			);

			isStoppingForRebuild = true;
			await stopManagedProcess(wranglerChild);
			isStoppingForRebuild = false;

			const ok = runTenantBuildCycle({
				includeSdkBuild: sdkChanged,
				includePackageBuild: packageChanged || sdkChanged,
				fatal: false,
			});

			if (ok) {
				startWrangler();
				console.log('Rebuild complete. Wrangler restarted with the updated output.');
			} else {
				console.error('Rebuild failed. Wrangler remains stopped until the next successful save.');
			}
		},
	});
}
