import { spawnSync } from 'node:child_process';
import {
	publishableWorkspacePackages,
	changedWorkspacePackages,
} from './workspace-tools.ts';

const cliArgs = new Set(process.argv.slice(2));
const verifyChangedOnly = cliArgs.has('--changed');
const fullSmoke = cliArgs.has('--full-smoke') || process.env.TREESEED_RELEASE_FULL_SMOKE === '1';
const publishablePackages = publishableWorkspacePackages();
const packagesToVerify = verifyChangedOnly
	? changedWorkspacePackages({ packages: publishablePackages, includeDependents: true })
	: publishablePackages;
const timings: Array<{ label: string; durationMs: number; status: 'completed' | 'failed' }> = [];

function nowLabel() {
	return new Date().toISOString();
}

function logStep(message: string) {
	console.log(`[release-verify ${nowLabel()}] ${message}`);
}

async function withTiming(label: string, action: () => Promise<void> | void) {
	const startedAt = Date.now();
	logStep(`${label} started`);
	try {
		await action();
		const durationMs = Date.now() - startedAt;
		timings.push({ label, durationMs, status: 'completed' });
		logStep(`${label} completed in ${(durationMs / 1000).toFixed(1)}s`);
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		timings.push({ label, durationMs, status: 'failed' });
		logStep(`${label} failed in ${(durationMs / 1000).toFixed(1)}s`);
		throw error;
	}
}

function printSummary() {
	if (timings.length === 0) {
		return;
	}

	console.log('[release-verify] Stage summary');
	for (const entry of timings) {
		console.log(
			`[release-verify] ${entry.status === 'completed' ? 'ok  ' : 'fail'} ${entry.label} (${(entry.durationMs / 1000).toFixed(1)}s)`,
		);
	}
}

function verifyManifest(pkg: (typeof publishablePackages)[number]) {
	for (const [dep, value] of Object.entries(pkg.packageJson.dependencies ?? {})) {
		if (!dep.startsWith('@treeseed/')) {
			continue;
		}
		if (String(value).startsWith('file:') || String(value).startsWith('workspace:')) {
			throw new Error(`${pkg.name} dependency ${dep} must not use local-only specifier "${value}".`);
		}
	}
}

function runReleaseVerify(pkg: (typeof publishablePackages)[number]) {
	const extraArgs = fullSmoke ? ['--', '--full-smoke'] : [];
	const result = spawnSync('npm', ['run', 'release:verify', ...extraArgs], {
		cwd: pkg.dir,
		stdio: 'inherit',
		env: process.env,
	});
	if (result.status !== 0) {
		throw new Error(`${pkg.name} release:verify failed`);
	}
}

if (packagesToVerify.length === 0) {
	console.log('No changed workspace packages to verify.');
	process.exit(0);
}

try {
	logStep(
		`verifying ${packagesToVerify.map((pkg) => pkg.name).join(', ')} with package-owned ${fullSmoke ? 'full' : 'fast'} verification`,
	);
	for (const pkg of packagesToVerify) {
		await withTiming(`${pkg.name} manifest verification`, async () => {
			verifyManifest(pkg);
		});
		await withTiming(`${pkg.name} release:verify`, async () => {
			runReleaseVerify(pkg);
		});
	}

	console.log(`Release verification passed for: ${packagesToVerify.map((pkg) => pkg.name).join(', ')}`);
} finally {
	printSummary();
}
