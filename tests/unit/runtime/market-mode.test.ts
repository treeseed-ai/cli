import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { handleMarket } from '../../../src/cli/handlers/content/market.ts';
import {
	assertMarketIntegrationEnabled,
	MarketIntegrationDisabledError,
	resolveMarketIntegrationMode,
} from '../../../src/cli/handlers/content/support/market-mode.ts';

test('local development can disable Market while retaining its immutable profile identity', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-market-mode-'));
	try {
		mkdirSync(resolve(root, 'nested'));
		writeFileSync(resolve(root, 'nested/treeseed.site.yaml'), 'market: { profile: treeseed }\n');
		writeFileSync(resolve(root, 'treeseed.site.yaml'), `market: { profile: treeseed }
development:
  local:
    marketConnectivity: disabled
    inventory: { source: seed, path: seeds/local.yaml }
`);
		assert.deepEqual(resolveMarketIntegrationMode(resolve(root, 'nested')), {
			enabled: false,
			manifestPath: resolve(root, 'treeseed.site.yaml'),
			workspaceRoot: root,
			profile: 'treeseed',
			inventorySource: 'seed',
			seedPath: 'seeds/local.yaml',
		});
		assert.throws(() => assertMarketIntegrationEnabled(root, 'treeseed'), (error) =>
			error instanceof MarketIntegrationDisabledError && error.code === 'market_integration_disabled');
		assert.doesNotThrow(() => assertMarketIntegrationEnabled(root, 'local'));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Market status returns the stable disabled result without network access', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-market-disabled-handler-'));
	const originalFetch = globalThis.fetch;
	let fetched = false;
	try {
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'market: { profile: treeseed }\ndevelopment: { local: { marketConnectivity: disabled } }\n');
		globalThis.fetch = (async () => { fetched = true; throw new Error('unexpected fetch'); }) as typeof fetch;
		const result = await handleMarket({ commandName: 'market', args: {}, positionals: ['status'], rawArgs: [] }, {
			cwd: root, env: { HOME: resolve(root, 'missing-home') }, outputFormat: 'json', write() {}, spawn: (() => { throw new Error('unexpected spawn'); }) as never,
		});
		assert.equal(result.exitCode, 0);
		assert.equal(result.report?.code, 'market_integration_disabled');
		assert.equal(fetched, false);
	} finally {
		globalThis.fetch = originalFetch;
		rmSync(root, { recursive: true, force: true });
	}
});

test('Market remains enabled when no local policy is declared', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-market-mode-default-'));
	try {
		assert.deepEqual(resolveMarketIntegrationMode(root), {
			enabled: true,
			manifestPath: null,
			workspaceRoot: root,
			profile: 'treeseed',
			inventorySource: 'api',
			seedPath: 'seeds/treeseed.yaml',
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
