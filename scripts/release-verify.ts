import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from './package-tools.ts';

const npmCacheDir = resolve(tmpdir(), 'treeseed-npm-cache');
const textExtensions = new Set(['.js', '.ts', '.mjs', '.cjs', '.d.ts', '.json', '.md']);
const forbiddenPatterns = [
	/['"`]workspace:[^'"`\n]+['"`]/,
	/['"`](?:\.\.\/|\.\/)[^'"`\n]*src\/[^'"`\n]*\.(?:[cm]?js|ts|tsx|json|astro|css)['"`]/,
	/['"`][^'"`\n]*\/packages\/[^'"`\n]*\/src\/[^'"`\n]*['"`]/,
];

function run(command: string, args: string[], cwd = packageRoot, capture = false) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		env: {
			...process.env,
			npm_config_cache: npmCacheDir,
			NPM_CONFIG_CACHE: npmCacheDir,
		},
	});

	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
	}

	return (result.stdout ?? '').trim();
}

function walkFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

function scanDirectory(root: string) {
	for (const filePath of walkFiles(root)) {
		if (!textExtensions.has(extname(filePath))) continue;
		const source = readFileSync(filePath, 'utf8');
		for (const pattern of forbiddenPatterns) {
			if (pattern.test(source)) {
				throw new Error(`${filePath} contains forbidden publish reference matching ${pattern}.`);
			}
		}
	}
}

function resolveNodeModulesRoot() {
	let lastCandidate: string | null = null;
	let current = packageRoot;
	while (true) {
		const candidate = resolve(current, 'node_modules');
		try {
			readdirSync(candidate);
			lastCandidate = candidate;
		} catch {
		}

		const parent = resolve(current, '..');
		if (parent === current) break;
		current = parent;
	}

	if (lastCandidate) {
		return lastCandidate;
	}

	throw new Error(`Unable to locate node_modules for ${packageRoot}.`);
}

function runtimeDependencyNames() {
	const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
	};
	return new Set(Object.keys(packageJson.dependencies ?? {}));
}

function resolveWorkspaceRuntimePackageRoots() {
	const runtimeDependencies = runtimeDependencyNames();
	const roots = new Map<string, string>();
	for (const packageName of runtimeDependencies) {
		if (!packageName.startsWith('@treeseed/')) continue;
		const folderName = packageName.slice('@treeseed/'.length);
		const candidateRoot = resolve(packageRoot, '..', folderName);
		if (existsSync(resolve(candidateRoot, 'package.json'))) {
			roots.set(packageName, candidateRoot);
		}
	}
	return roots;
}

function mirrorDependencies(tempRoot: string, excludedPackages = new Set<string>()) {
	const sharedNodeModules = resolveNodeModulesRoot();
	const runtimeDependencies = runtimeDependencyNames();
	for (const entry of readdirSync(sharedNodeModules, { withFileTypes: true })) {
		if (entry.name === '.bin') {
			continue;
		}

		if (entry.name === '@treeseed') {
			const sourceScopeRoot = resolve(sharedNodeModules, entry.name);
			const targetScopeRoot = resolve(tempRoot, 'node_modules', entry.name);
			mkdirSync(targetScopeRoot, { recursive: true });
			for (const scopedEntry of readdirSync(sourceScopeRoot, { withFileTypes: true })) {
				const packageName = `@treeseed/${scopedEntry.name}`;
				if (
					scopedEntry.name === 'cli'
					|| !runtimeDependencies.has(packageName)
					|| excludedPackages.has(packageName)
				) {
					continue;
				}

				const targetPath = resolve(targetScopeRoot, scopedEntry.name);
				symlinkSync(resolve(sourceScopeRoot, scopedEntry.name), targetPath, scopedEntry.isDirectory() ? 'dir' : 'file');
			}
			continue;
		}

		const targetPath = resolve(tempRoot, 'node_modules', entry.name);
		mkdirSync(dirname(targetPath), { recursive: true });
		symlinkSync(resolve(sharedNodeModules, entry.name), targetPath, entry.isDirectory() ? 'dir' : 'file');
	}
}

function pack(root: string, fallbackName: string) {
	const output = run('npm', ['pack', '--ignore-scripts', '--cache', npmCacheDir], root, true);
	const filename = output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1)
		?? readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
			.at(-1)
		?? fallbackName;
	return resolve(root, filename);
}

function installPackagedPackage(extractRoot: string, tempRoot: string, tarballPath: string, folderName: string) {
	mkdirSync(resolve(tempRoot, 'node_modules', '@treeseed'), { recursive: true });
	run('tar', ['-xzf', tarballPath, '-C', extractRoot]);
	run('cp', ['-R', resolve(extractRoot, 'package'), resolve(tempRoot, 'node_modules', '@treeseed', folderName)]);
	rmSync(resolve(extractRoot, 'package'), { recursive: true, force: true });
}

function assertRequiredDistFiles() {
	const requiredPaths = [
		resolve(packageRoot, 'dist', 'index.js'),
		resolve(packageRoot, 'dist', 'cli', 'main.js'),
		resolve(packageRoot, 'dist', 'cli', 'runtime.js'),
		resolve(packageRoot, 'dist', 'cli', 'registry.js'),
	];

	for (const filePath of requiredPaths) {
		if (!existsSync(filePath)) {
			throw new Error(`Missing required publish artifact: ${filePath}`);
		}
	}

	if (existsSync(resolve(packageRoot, 'dist', 'scripts'))) {
		throw new Error('CLI dist should not ship a local scripts runtime. The SDK package is authoritative.');
	}
}

function assertPackageDependencyShape() {
	const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
	};
	const dependencyNames = Object.keys(packageJson.dependencies ?? {}).sort();
	if (dependencyNames.join(',') !== '@treeseed/sdk') {
		throw new Error(`CLI runtime dependencies must be exactly @treeseed/sdk. Found: ${dependencyNames.join(', ') || '(none)'}`);
	}

	const packageLock = readFileSync(resolve(packageRoot, 'package-lock.json'), 'utf8');
	if (packageLock.includes('"@treeseed/agent"')) {
		throw new Error('CLI package-lock.json still references @treeseed/agent.');
	}
}

run('npm', ['run', 'lint']);
assertPackageDependencyShape();
scanDirectory(resolve(packageRoot, 'dist'));
assertRequiredDistFiles();
run('npm', ['test']);

const stageRoot = mkdtempSync(join(tmpdir(), 'treeseed-cli-release-'));
const extractRoot = resolve(stageRoot, 'extract');
const installRoot = resolve(stageRoot, 'install');
const workspaceRuntimePackageRoots = resolveWorkspaceRuntimePackageRoots();

try {
	mkdirSync(extractRoot, { recursive: true });
	const cliTarball = pack(packageRoot, 'treeseed-cli.tgz');
	const stagedTarballs: string[] = [cliTarball];

	mirrorDependencies(installRoot, new Set(workspaceRuntimePackageRoots.keys()));
	for (const [packageName, dependencyRoot] of workspaceRuntimePackageRoots.entries()) {
		const folderName = packageName.slice('@treeseed/'.length);
		const tarballPath = pack(dependencyRoot, `treeseed-${folderName}.tgz`);
		stagedTarballs.push(tarballPath);
		installPackagedPackage(extractRoot, installRoot, tarballPath, folderName);
	}
	installPackagedPackage(extractRoot, installRoot, cliTarball, 'cli');
	writeFileSync(resolve(installRoot, 'package.json'), `${JSON.stringify({ name: 'treeseed-cli-smoke', private: true, type: 'module' }, null, 2)}\n`, 'utf8');
	run(process.execPath, ['node_modules/@treeseed/cli/dist/cli/main.js', '--help'], installRoot);
	run(process.execPath, ['node_modules/@treeseed/cli/dist/cli/main.js', 'agents', '--help'], installRoot);
	console.log('CLI packed-install bin smoke passed.');
	for (const tarballPath of stagedTarballs) {
		rmSync(tarballPath, { force: true });
	}
} finally {
	rmSync(stageRoot, { recursive: true, force: true });
}
