import { packageScriptPath } from './package-tools.ts';
import { publishableWorkspacePackages, changedWorkspacePackages, run } from './workspace-tools.ts';

const publishablePackages = publishableWorkspacePackages();
const changed = changedWorkspacePackages({ packages: publishablePackages, includeDependents: true });

if (changed.length === 0) {
	console.log('No changed workspace packages to publish.');
	process.exit(0);
}

console.log(`Publishing changed workspace packages in order: ${changed.map((pkg) => pkg.name).join(', ')}`);

run(process.execPath, [packageScriptPath('workspace-release-verify'), '--changed', '--full-smoke']);

for (const pkg of changed) {
	console.log(`Publishing ${pkg.name}`);
	run('npm', ['run', 'release:publish'], {
		cwd: pkg.dir,
	});
}
