import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corePackageRoot, packageRoot } from './package-tools.ts';

const pathsPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const cliPackageRoot = pathsPackageRoot.endsWith('/dist')
	? resolve(pathsPackageRoot, '..')
	: pathsPackageRoot;
export { corePackageRoot, packageRoot };
export const workspaceRoot = resolve(cliPackageRoot, '..');
export const templatesRoot = resolve(workspaceRoot, 'templates');
export const examplesRoot = resolve(workspaceRoot, 'examples');
export const fixturesRoot = resolve(workspaceRoot, 'fixtures');
export const referenceAppsRoot = resolve(workspaceRoot, 'reference-apps');
export const toolingRoot = resolve(workspaceRoot, 'tooling');
export const servicesRoot = resolve(packageRoot, 'services');
export const mailpitComposeFile = resolve(servicesRoot, 'compose.yml');
export const fixtureRoot = resolve(corePackageRoot, 'fixture');
export const fixtureWranglerConfig = resolve(fixtureRoot, 'wrangler.toml');
export const fixtureMigrationsRoot = resolve(fixtureRoot, 'migrations');
export const fixtureSrcRoot = resolve(fixtureRoot, 'src');
export const cliPackageVersion = JSON.parse(readFileSync(resolve(cliPackageRoot, 'package.json'), 'utf8')).version;
export const corePackageVersion = JSON.parse(readFileSync(resolve(corePackageRoot, 'package.json'), 'utf8')).version;
