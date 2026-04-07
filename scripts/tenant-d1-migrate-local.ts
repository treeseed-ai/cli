import { resolve } from 'node:path';
import { runLocalD1Migrations } from './d1-migration-lib.ts';
import { ensureGeneratedWranglerConfig } from './deploy-lib.ts';

const tenantRoot = process.cwd();
const migrationsRoot = resolve(tenantRoot, 'migrations');
const { wranglerPath: wranglerConfig } = ensureGeneratedWranglerConfig(tenantRoot);

runLocalD1Migrations({
	cwd: tenantRoot,
	wranglerConfig,
	migrationsRoot,
});
