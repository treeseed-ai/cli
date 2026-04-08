import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corePackageRoot, packageRoot } from './package-tools.ts';

const pathsPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const cliPackageRoot = pathsPackageRoot.endsWith('/dist')
	? resolve(pathsPackageRoot, '..')
	: pathsPackageRoot;
export { corePackageRoot, packageRoot };
export const workspaceRoot = resolve(cliPackageRoot, '..');
function resolveProjectRoot(localPath: string, workspacePath: string) {
	return existsSync(localPath) ? localPath : workspacePath;
}

export const templatesRoot = resolveProjectRoot(resolve(cliPackageRoot, 'templates'), resolve(workspaceRoot, 'templates'));
export const examplesRoot = resolveProjectRoot(resolve(cliPackageRoot, 'examples'), resolve(workspaceRoot, 'examples'));
export const fixturesRoot = resolveProjectRoot(resolve(cliPackageRoot, '.fixtures', 'treeseed-fixtures'), resolve(workspaceRoot, 'fixtures'));
export const referenceAppsRoot = resolveProjectRoot(resolve(cliPackageRoot, 'reference-apps'), resolve(workspaceRoot, 'reference-apps'));
export const toolingRoot = resolveProjectRoot(resolve(cliPackageRoot, 'tooling'), resolve(workspaceRoot, 'tooling'));
export const servicesRoot = resolve(packageRoot, 'services');
export const mailpitComposeFile = resolve(servicesRoot, 'compose.yml');
export const fixtureRoot = resolve(corePackageRoot, 'fixture');
export const fixtureWranglerConfig = resolve(fixtureRoot, 'wrangler.toml');
export const fixtureMigrationsRoot = resolve(fixtureRoot, 'migrations');
export const fixtureSrcRoot = resolve(fixtureRoot, 'src');
export const cliPackageVersion = JSON.parse(readFileSync(resolve(cliPackageRoot, 'package.json'), 'utf8')).version;
export const corePackageVersion = JSON.parse(readFileSync(resolve(corePackageRoot, 'package.json'), 'utf8')).version;
