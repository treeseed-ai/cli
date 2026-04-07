import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corePackageRoot, packageRoot } from './package-tools.ts';

const pathsPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const cliPackageRoot = pathsPackageRoot.endsWith('/dist')
	? resolve(pathsPackageRoot, '..')
	: pathsPackageRoot;
export { corePackageRoot, packageRoot };
export const servicesRoot = resolve(packageRoot, 'services');
export const mailpitComposeFile = resolve(servicesRoot, 'compose.yml');
export const fixtureRoot = resolve(corePackageRoot, 'fixture');
export const fixtureWranglerConfig = resolve(fixtureRoot, 'wrangler.toml');
export const fixtureMigrationsRoot = resolve(fixtureRoot, 'migrations');
export const fixtureSrcRoot = resolve(fixtureRoot, 'src');
