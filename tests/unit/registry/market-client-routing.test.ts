import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { createMarketClientForInvocation } from '../../../src/cli/handlers/content/market-utils.ts';

describe('human client transport routing', () => {
	it('keeps Market operations central while routing control-plane operations to a sovereign API', () => {
		const resolved = createMarketClientForInvocation({
			args: { market: 'https://api.treeseed.dev' }, positionals: [], commandName: 'stage',
		} as any, {
			cwd: process.cwd(), env: {
				...process.env,
				TREESEED_MARKET_API_BASE_URL: 'https://api.treeseed.dev',
				TREESEED_API_BASE_URL: 'https://control.customer.example',
				TREESEED_CONTROL_PLANE_MODE: 'managed',
			}, write() {},
		} as any);

		assert.equal(resolved.client.marketBaseUrl, 'https://api.treeseed.dev');
		assert.equal(resolved.client.controlPlaneBaseUrl, 'https://control.customer.example');
		assert.equal(resolved.client.controlPlaneMode, 'managed');
		assert.equal(resolved.client.baseUrlForPath('/v1/market/catalog'), 'https://api.treeseed.dev');
		assert.equal(resolved.client.baseUrlForPath('/v1/governance/execution-authorities/validate'), 'https://control.customer.example');
	});
});
