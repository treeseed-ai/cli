import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changedWorkspacePackages, publishableWorkspacePackages, run, sortWorkspacePackages, workspacePackages, workspaceRoot } from './workspace-tools.ts';

export const MERGE_CONFLICT_EXIT_CODE = 12;

function parseSemver(version) {
	const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (!match) {
		throw new Error(`Unsupported version "${version}". Expected x.y.z.`);
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

export function incrementPatchVersion(version) {
	const parsed = parseSemver(version);
	return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function incrementVersion(version, level = 'patch') {
	const parsed = parseSemver(version);
	if (level === 'major') {
		return `${parsed.major + 1}.0.0`;
	}
	if (level === 'minor') {
		return `${parsed.major}.${parsed.minor + 1}.0`;
	}
	if (level === 'patch') {
		return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
	}
	throw new Error(`Unsupported release bump "${level}". Expected major, minor, or patch.`);
}

function readPackageJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writePackageJson(filePath, value) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function internalDependencyFields(packageJson) {
	return ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
		.filter((field) => packageJson[field] && typeof packageJson[field] === 'object');
}

export function planWorkspaceVersionChanges(root = workspaceRoot()) {
	const packages = workspacePackages(root).map((pkg) => ({
		...pkg,
		packageJsonPath: resolve(pkg.dir, 'package.json'),
		packageJson: readPackageJson(resolve(pkg.dir, 'package.json')),
	}));
	const orderedPackages = sortWorkspacePackages(packages);
	const publishable = new Set(publishableWorkspacePackages(root).map((pkg) => pkg.name));
	const changedPublishable = new Set(
		changedWorkspacePackages({
			root,
			packages: orderedPackages.filter((pkg) => publishable.has(pkg.name)),
			includeDependents: false,
		}).map((pkg) => pkg.name),
	);

	const versions = new Map(orderedPackages.map((pkg) => [pkg.name, pkg.packageJson.version]));
	const bumped = new Set(changedPublishable);
	const touched = new Set();

	for (const name of changedPublishable) {
		versions.set(name, incrementPatchVersion(versions.get(name)));
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const pkg of orderedPackages) {
			let packageDependencyChanged = false;
			for (const field of internalDependencyFields(pkg.packageJson)) {
				for (const depName of Object.keys(pkg.packageJson[field] ?? {})) {
					if (!versions.has(depName)) {
						continue;
					}
					const nextSpec = `^${versions.get(depName)}`;
					if (pkg.packageJson[field][depName] === nextSpec) {
						continue;
					}
					pkg.packageJson[field][depName] = nextSpec;
					packageDependencyChanged = true;
					touched.add(pkg.name);
				}
			}

			if (packageDependencyChanged && publishable.has(pkg.name) && !bumped.has(pkg.name)) {
				bumped.add(pkg.name);
				versions.set(pkg.name, incrementPatchVersion(versions.get(pkg.name)));
				changed = true;
			}
		}
	}

	for (const pkg of orderedPackages) {
		if (!bumped.has(pkg.name)) {
			continue;
		}
		const nextVersion = versions.get(pkg.name);
		if (pkg.packageJson.version !== nextVersion) {
			pkg.packageJson.version = nextVersion;
			touched.add(pkg.name);
		}
	}

	return {
		packages: orderedPackages,
		publishable,
		bumped,
		touched,
	};
}

export function applyWorkspaceVersionChanges(plan) {
	for (const pkg of plan.packages) {
		if (!plan.touched.has(pkg.name)) {
			continue;
		}
		writePackageJson(pkg.packageJsonPath, pkg.packageJson);
	}
	return plan;
}

export function planWorkspaceReleaseBump(level = 'patch', root = workspaceRoot()) {
	const packages = workspacePackages(root).map((pkg) => ({
		...pkg,
		packageJsonPath: resolve(pkg.dir, 'package.json'),
		packageJson: readPackageJson(resolve(pkg.dir, 'package.json')),
	}));
	const publishable = new Set(publishableWorkspacePackages(root).map((pkg) => pkg.name));
	const touched = new Set();
	const versions = new Map();

	for (const pkg of packages) {
		if (!publishable.has(pkg.name)) {
			continue;
		}
		const nextVersion = incrementVersion(pkg.packageJson.version, level);
		pkg.packageJson.version = nextVersion;
		versions.set(pkg.name, nextVersion);
		touched.add(pkg.name);
	}

	for (const pkg of packages) {
		for (const field of internalDependencyFields(pkg.packageJson)) {
			for (const depName of Object.keys(pkg.packageJson[field] ?? {})) {
				if (!versions.has(depName)) {
					continue;
				}
				pkg.packageJson[field][depName] = `^${versions.get(depName)}`;
				touched.add(pkg.name);
			}
		}
	}

	return {
		packages,
		touched,
		versions,
		level,
	};
}

export function repoRoot(cwd = workspaceRoot()) {
	return run('git', ['rev-parse', '--show-toplevel'], { cwd, capture: true }).trim();
}

export function currentBranch(repoDir) {
	return run('git', ['branch', '--show-current'], { cwd: repoDir, capture: true }).trim();
}

export function originRemoteUrl(repoDir) {
	return run('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, capture: true }).trim();
}

export function gitStatusPorcelain(repoDir) {
	return run('git', ['status', '--porcelain'], { cwd: repoDir, capture: true }).trim();
}

export function hasMeaningfulChanges(repoDir) {
	return gitStatusPorcelain(repoDir).length > 0;
}

export function countConflictMarkers(source) {
	return {
		start: (source.match(/^<{7} /gm) ?? []).length,
		middle: (source.match(/^={7}$/gm) ?? []).length,
		end: (source.match(/^>{7} /gm) ?? []).length,
	};
}

export function collectMergeConflictReport(repoDir) {
	const branch = currentBranch(repoDir);
	const conflictedFiles = run('git', ['diff', '--name-only', '--diff-filter=U'], {
		cwd: repoDir,
		capture: true,
	})
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const status = run('git', ['status', '--short'], { cwd: repoDir, capture: true });
	const perFile = conflictedFiles.map((filePath) => {
		const fullPath = resolve(repoDir, filePath);
		const source = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
		return {
			filePath,
			markers: countConflictMarkers(source),
			diff: run('git', ['diff', '--', filePath], { cwd: repoDir, capture: true }),
		};
	});

	return {
		branch,
		rebaseInProgress: true,
		conflictedFiles,
		status,
		perFile,
	};
}

export function formatMergeConflictReport(report, repoDir, targetBranch = 'main') {
	const lines = [
		`Treeseed save failed due to merge conflicts during \`git pull --rebase origin ${targetBranch}\`.`,
		`Repository root: ${repoDir}`,
		`Branch: ${report.branch}`,
		`Rebase in progress: ${report.rebaseInProgress ? 'yes' : 'no'}`,
		'Git status:',
		report.status || '(no git status output)',
		'Conflicted files:',
	];

	for (const file of report.perFile) {
		lines.push(`- ${file.filePath}`);
		lines.push(`  markers: start=${file.markers.start} middle=${file.markers.middle} end=${file.markers.end}`);
		lines.push('  diff:');
		lines.push(file.diff || '  (no diff output)');
	}

	lines.push('Next steps:');
	lines.push('- Inspect conflicted files and reconcile local vs remote changes.');
	lines.push('- After resolving files, run `git add <files>` and `git rebase --continue`.');
	lines.push('- Or abort with `git rebase --abort` if you need to restart the save flow.');

	return lines.join('\n');
}
