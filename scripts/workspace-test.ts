import { sortWorkspacePackages, workspacePackages, run } from './workspace-tools.ts';

const packages = sortWorkspacePackages(workspacePackages());

for (const pkg of packages) {
	if (typeof pkg.packageJson.scripts?.['test:unit'] === 'string') {
		run('npm', ['run', 'test:unit'], { cwd: pkg.dir });
		continue;
	}

	if (typeof pkg.packageJson.scripts?.test === 'string') {
		run('npm', ['run', 'test'], { cwd: pkg.dir });
	}
}
