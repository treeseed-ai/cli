import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

function escapeRegex(source) {
	return source.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function segmentPatternToRegex(pattern) {
	return new RegExp(`^${escapeRegex(pattern).replaceAll('*', '.*')}$`);
}

function expandWorkspacePattern(root, pattern) {
	const segments = pattern.split(/[\\/]+/).filter(Boolean);
	const results = [];

	function visit(baseDir, index) {
		if (index >= segments.length) {
			results.push(baseDir);
			return;
		}

		const segment = segments[index];
		if (!segment.includes('*')) {
			const nextDir = resolve(baseDir, segment);
			if (existsSync(nextDir)) {
				visit(nextDir, index + 1);
			}
			return;
		}

		if (!existsSync(baseDir)) {
			return;
		}

		const matcher = segmentPatternToRegex(segment);
		for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
			if (!entry.isDirectory() || !matcher.test(entry.name)) {
				continue;
			}
			visit(resolve(baseDir, entry.name), index + 1);
		}
	}

	visit(root, 0);
	return results;
}

export function workspaceRoot() {
	return process.cwd();
}

export function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function workspacePackageJson(root = workspaceRoot()) {
	return readJson(resolve(root, 'package.json'));
}

export function workspacePatterns(root = workspaceRoot()) {
	const packageJson = workspacePackageJson(root);
	const workspaces = Array.isArray(packageJson.workspaces)
		? packageJson.workspaces
		: Array.isArray(packageJson.workspaces?.packages)
			? packageJson.workspaces.packages
			: [];
	return workspaces.filter((value) => typeof value === 'string' && value.trim().length > 0);
}

export function isWorkspaceRoot(root = workspaceRoot()) {
	return workspacePatterns(root).length > 0;
}

export function workspacePackages(root = workspaceRoot()) {
	const discovered = new Map();

	for (const pattern of workspacePatterns(root)) {
		for (const dir of expandWorkspacePattern(root, pattern)) {
			const packageJsonPath = resolve(dir, 'package.json');
			if (!existsSync(packageJsonPath)) {
				continue;
			}
			const packageJson = readJson(packageJsonPath);
			discovered.set(dir, {
				dir,
				name: packageJson.name,
				packageJson,
				relativeDir: relative(root, dir).replaceAll('\\', '/'),
			});
		}
	}

	return [...discovered.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function internalDependenciesFor(pkg, packageNames) {
	const internalDeps = new Set();
	for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
		for (const name of Object.keys(pkg.packageJson[field] ?? {})) {
			if (packageNames.has(name)) {
				internalDeps.add(name);
			}
		}
	}
	return internalDeps;
}

export function sortWorkspacePackages(packages) {
	const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const packageNames = new Set(packageMap.keys());
	const dependents = new Map(packages.map((pkg) => [pkg.name, new Set()]));
	const indegree = new Map(packages.map((pkg) => [pkg.name, 0]));

	for (const pkg of packages) {
		for (const dep of internalDependenciesFor(pkg, packageNames)) {
			dependents.get(dep)?.add(pkg.name);
			indegree.set(pkg.name, (indegree.get(pkg.name) ?? 0) + 1);
		}
	}

	const ready = [...packages]
		.filter((pkg) => (indegree.get(pkg.name) ?? 0) === 0)
		.sort((left, right) => left.name.localeCompare(right.name));
	const ordered = [];

	while (ready.length > 0) {
		const next = ready.shift();
		if (!next) {
			break;
		}
		ordered.push(next);
		for (const dependentName of [...(dependents.get(next.name) ?? [])].sort()) {
			const nextDegree = (indegree.get(dependentName) ?? 0) - 1;
			indegree.set(dependentName, nextDegree);
			if (nextDegree === 0) {
				const dependent = packageMap.get(dependentName);
				if (dependent) {
					ready.push(dependent);
					ready.sort((left, right) => left.name.localeCompare(right.name));
				}
			}
		}
	}

	if (ordered.length !== packages.length) {
		return [...packages].sort((left, right) => left.name.localeCompare(right.name));
	}

	return ordered;
}

export function packagesWithScript(scriptName, root = workspaceRoot()) {
	return sortWorkspacePackages(
		workspacePackages(root).filter((pkg) => typeof pkg.packageJson.scripts?.[scriptName] === 'string'),
	);
}

export function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? workspaceRoot(),
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: options.capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		timeout: options.timeoutMs,
	});

	if (result.status !== 0) {
		const message =
			(result.error?.message ? `${result.error.message}\n` : '')
			+ (
				result.stderr?.trim()
				|| result.stdout?.trim()
				|| `${command} ${args.join(' ')} failed`
			);
		throw new Error(message);
	}

	return (result.stdout ?? '').trim();
}

function canResolveGitRef(baseRef, cwd = workspaceRoot()) {
	const result = spawnSync('git', ['rev-parse', '--verify', baseRef], {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return result.status === 0;
}

function resolveChangedFilesBaseRef(baseRef, cwd = workspaceRoot()) {
	if (canResolveGitRef(baseRef, cwd)) {
		return baseRef;
	}

	return null;
}

function changedWorkspaceFiles(baseRef, cwd = workspaceRoot()) {
	const changedFiles = new Set();
	const resolvedBaseRef = resolveChangedFilesBaseRef(baseRef, cwd);
	const diffCommands = [
		['diff', '--name-only'],
		['diff', '--name-only', '--cached'],
		['ls-files', '--others', '--exclude-standard'],
	];

	if (resolvedBaseRef) {
		diffCommands.unshift(['diff', '--name-only', resolvedBaseRef, 'HEAD']);
	}

	for (const args of diffCommands) {
		const output = run('git', args, { cwd, capture: true });
		for (const line of output.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
			changedFiles.add(line);
		}
	}
	return changedFiles;
}

export function changedWorkspacePackages(options = {}) {
	const root = options.root ?? workspaceRoot();
	const baseRef = options.baseRef ?? process.env.TREESEED_RELEASE_BASE_REF ?? 'HEAD^';
	const includeDependents = options.includeDependents ?? false;
	const packages = options.packages ?? workspacePackages(root);
	const changedFiles = changedWorkspaceFiles(baseRef, root);
	const changed = new Set(
		packages
			.filter((pkg) => [...changedFiles].some((file) => file === pkg.relativeDir || file.startsWith(`${pkg.relativeDir}/`)))
			.map((pkg) => pkg.name),
	);

	if (includeDependents && changed.size > 0) {
		const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
		const packageNames = new Set(packageMap.keys());
		const reverseDeps = new Map(packages.map((pkg) => [pkg.name, new Set()]));
		for (const pkg of packages) {
			for (const dep of internalDependenciesFor(pkg, packageNames)) {
				reverseDeps.get(dep)?.add(pkg.name);
			}
		}

		const queue = [...changed];
		while (queue.length > 0) {
			const next = queue.shift();
			for (const dependent of reverseDeps.get(next) ?? []) {
				if (changed.has(dependent)) {
					continue;
				}
				changed.add(dependent);
				queue.push(dependent);
			}
		}
	}

	return sortWorkspacePackages(packages.filter((pkg) => changed.has(pkg.name)));
}

export function publishableWorkspacePackages(root = workspaceRoot()) {
	return packagesWithScript('release:publish', root);
}

export function createTempDir(prefix) {
	const baseRoot = resolve(process.env.TREESEED_TEMP_ROOT ?? resolve(workspaceRoot(), '.local', 'tmp'));
	mkdirSync(baseRoot, { recursive: true });
	return mkdtempSync(join(baseRoot, prefix));
}

export function cleanupDir(dirPath) {
	if (dirPath && existsSync(dirPath)) {
		rmSync(dirPath, { recursive: true, force: true });
	}
}
