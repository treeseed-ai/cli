import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { loadTreeseedDeployConfig } from '@treeseed/core/deploy/config';
import { loadTreeseedManifest } from '@treeseed/core/tenant-config';
import { parseSiteConfig } from '@treeseed/core/utils/site-config-schema';
import { corePackageRoot } from './package-tools.ts';

const tenantRoot = process.cwd();
const workerEntry = resolve(corePackageRoot, 'dist/worker/forms-worker.js');
const outFile = resolve(tenantRoot, '.treeseed/generated/worker/index.js');

function ensureDir(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function loadSiteConfig(tenantConfig) {
	const siteConfigPath = resolve(tenantRoot, tenantConfig.siteConfigPath);
	return parseSiteConfig(readFileSync(siteConfigPath, 'utf8'));
}

const tenantConfig = loadTreeseedManifest();
const siteConfig = loadSiteConfig(tenantConfig);
const deployConfig = loadTreeseedDeployConfig();

ensureDir(outFile);

await build({
	entryPoints: [workerEntry],
	outfile: outFile,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	logLevel: 'silent',
	external: ['cloudflare:sockets'],
	define: {
		__TREESEED_SITE_CONFIG__: JSON.stringify(siteConfig),
		__TREESEED_DEPLOY_CONFIG__: JSON.stringify(deployConfig),
	},
});

writeFileSync(
	resolve(tenantRoot, '.treeseed/generated/worker/package.json'),
	'{\n  "type": "module"\n}\n',
	'utf8',
);
