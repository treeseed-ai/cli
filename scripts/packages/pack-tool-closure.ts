import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageNames = [
	'@treeseed/sdk',
	'@treeseed/ui',
	'@treeseed/core',
	'@treeseed/agent',
	'@treeseed/cli',
];
const requestedOutputRoot = process.argv[2] ?? process.env.TREESEED_TOOL_CLOSURE_OUTPUT;
const outputRoot = requestedOutputRoot
	? resolve(requestedOutputRoot)
	: mkdtempSync(resolve(tmpdir(), 'treeseed-cli-tool-artifacts-'));
const stagingRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-tool-closure-'));

function packagePath(name: string) {
	if (name === '@treeseed/cli') return packageRoot;
	const installedPath = resolve(packageRoot, 'node_modules', ...name.split('/'));
	if (existsSync(resolve(installedPath, 'package.json'))) return installedPath;
	const workspacePath = resolve(packageRoot, '..', name.slice('@treeseed/'.length));
	if (existsSync(resolve(workspacePath, 'package.json'))) return workspacePath;
	throw new Error(`Unable to resolve ${name} from the installed or workspace package graph.`);
}

function packageJson(path: string) {
	return JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8')) as Record<string, unknown>;
}

const packages = packageNames.map((name) => ({ name, path: packagePath(name) }));
const versions = new Map<string, string>();
for (const { path } of packages) {
	const manifest = packageJson(path);
	versions.set(String(manifest.name), String(manifest.version));
}

try {
	mkdirSync(outputRoot, { recursive: true });
	for (const { name, path } of packages) {
		const source = resolve(path);
		const destination = resolve(stagingRoot, name.slice('@treeseed/'.length));
		cpSync(source, destination, {
			recursive: true,
			filter: (entry) => {
				const relative = entry.slice(source.length).replace(/^\//, '');
				return relative !== 'node_modules'
					&& !relative.startsWith('node_modules/')
					&& relative !== '.git'
					&& !relative.startsWith('.git/')
					&& relative !== 'artifacts'
					&& !relative.startsWith('artifacts/');
			},
		});
		const manifestPath = resolve(destination, 'package.json');
		const manifest = packageJson(destination);
		for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
			const dependencies = manifest[field];
			if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
			for (const [name, version] of versions) {
				if (name in dependencies) {
					(dependencies as Record<string, string>)[name] = version;
				}
			}
		}
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
		const packed = spawnSync('npm', ['pack', destination, '--json', '--ignore-scripts', '--pack-destination', outputRoot], {
			encoding: 'utf8',
			stdio: 'pipe',
		});
		if (packed.status !== 0) {
			throw new Error(
				`Failed to pack ${String(manifest.name)}: ${packed.stderr?.trim() || packed.stdout?.trim() || 'unknown npm error'}`,
			);
		}
	}
} finally {
	rmSync(stagingRoot, { recursive: true, force: true });
	if (!requestedOutputRoot) {
		rmSync(outputRoot, { recursive: true, force: true });
	}
}
