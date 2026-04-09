import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listTemplateProducts, resolveTemplateDefinition } from '../dist/scripts/template-registry-lib.js';

function makeMachineConfigRoot(endpoint) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-template-catalog-'));
	const configDir = resolve(root, '.treeseed', 'config');
	mkdirSync(configDir, { recursive: true });
	writeFileSync(resolve(configDir, 'machine.yaml'), [
		'version: 1',
		'settings:',
		'  templates:',
		`    catalogEndpoint: ${endpoint}`,
		'',
	].join('\n'), 'utf8');
	return root;
}

function writeCatalogFixture(root, fileName, items) {
	const fixturePath = resolve(root, fileName);
	writeFileSync(fixturePath, JSON.stringify({ items }, null, 2), 'utf8');
	return fixturePath;
}

function writeCatalogCache(root, endpoint, items) {
	const cacheDir = resolve(root, '.treeseed', 'cache');
	mkdirSync(cacheDir, { recursive: true });
	writeFileSync(resolve(cacheDir, 'template-catalog.json'), JSON.stringify({
		endpoint,
		fetchedAt: '2026-04-08T00:00:00.000Z',
		items,
	}, null, 2), 'utf8');
}

const starterTemplate = {
	id: 'starter-basic',
	displayName: 'TreeSeed Basic',
	description: 'Starter',
	summary: 'Starter summary',
	status: 'live',
	category: 'starter',
	publisher: {
		id: 'treeseed',
		name: 'TreeSeed',
	},
	templateVersion: '1.0.0',
	templateApiVersion: 1,
	minCliVersion: '0.1.1',
	minCoreVersion: '0.1.2',
	fulfillment: {
		source: {
			repoUrl: 'https://example.com/repo.git',
			directory: 'templates/starter-basic',
			ref: 'main',
		},
		hooksPolicy: 'builtin_only',
		supportsReconcile: true,
	},
};

test('template registry reads the remote catalog from a configured file endpoint and falls back to cache', async () => {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-template-catalog-fixture-'));
	const fixturePath = writeCatalogFixture(root, 'catalog.json', [starterTemplate]);
	const fallbackEndpoint = 'https://127.0.0.1:9/search/templates';
	const cwd = makeMachineConfigRoot(`file:${fixturePath}`);

	const remoteProducts = await listTemplateProducts({ cwd, env: {} });
	assert.equal(remoteProducts.length, 1);
	assert.equal(remoteProducts[0]?.id, 'starter-basic');

	writeCatalogCache(cwd, fallbackEndpoint, [starterTemplate]);

	const warnings = [];
	const cachedProducts = await listTemplateProducts({
		cwd,
		env: {
			TREESEED_TEMPLATE_CATALOG_URL: fallbackEndpoint,
		},
		writeWarning: (message) => warnings.push(message),
	});

	assert.equal(cachedProducts.length, 1);
	assert.equal(cachedProducts[0]?.id, 'starter-basic');
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /Using cached template catalog/);
});

test('template definition resolution rejects templates missing from the remote catalog', async () => {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-template-catalog-empty-'));
	const fixturePath = writeCatalogFixture(root, 'empty.json', []);
	const cwd = makeMachineConfigRoot(`file:${fixturePath}`);

	await assert.rejects(
		() => resolveTemplateDefinition('starter-basic', { cwd, env: {} }),
		/Unable to resolve remote template product "starter-basic"\./,
	);
});
