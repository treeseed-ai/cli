import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function siteManifestPath(cwd: string) {
	let current = resolve(cwd);
	let fallback: string | null = null;
	while (true) {
		const candidate = resolve(current, 'treeseed.site.yaml');
		if (existsSync(candidate)) {
			fallback ??= candidate;
			const document = record(parse(readFileSync(candidate, 'utf8')));
			const localDevelopment = record(record(document.development).local);
			if (typeof localDevelopment.marketConnectivity === 'string') return candidate;
		}
		const parent = dirname(current);
		if (parent === current) return fallback;
		current = parent;
	}
}

export type MarketIntegrationMode = {
	enabled: boolean;
	manifestPath: string | null;
	workspaceRoot: string;
	profile: string;
	inventorySource: 'api' | 'seed';
	seedPath: string;
};

export class MarketIntegrationDisabledError extends Error {
	readonly code = 'market_integration_disabled';

	constructor() {
		super('Market integration is disabled for this local development workspace. Use the local control plane or enable Market explicitly after it is available.');
		this.name = 'MarketIntegrationDisabledError';
	}
}

export function resolveMarketIntegrationMode(cwd: string): MarketIntegrationMode {
	const manifestPath = siteManifestPath(cwd);
	if (!manifestPath) return { enabled: true, manifestPath: null, workspaceRoot: resolve(cwd), profile: 'treeseed', inventorySource: 'api', seedPath: 'seeds/treeseed.yaml' };
	const document = record(parse(readFileSync(manifestPath, 'utf8')));
	const market = record(document.market);
	const localDevelopment = record(record(document.development).local);
	const inventory = record(localDevelopment.inventory);
	const marketConnectivity = typeof localDevelopment.marketConnectivity === 'string'
		? localDevelopment.marketConnectivity.trim().toLowerCase()
		: null;
	if (marketConnectivity && marketConnectivity !== 'enabled' && marketConnectivity !== 'disabled') {
		throw new Error(`Unsupported development.local.marketConnectivity value ${String(localDevelopment.marketConnectivity)}.`);
	}
	const inventorySource = inventory.source === 'seed' ? 'seed' : 'api';
	return {
		enabled: marketConnectivity !== 'disabled' && market.enabled !== false,
		manifestPath,
		workspaceRoot: dirname(manifestPath),
		profile: typeof market.profile === 'string' && market.profile.trim() ? market.profile.trim() : 'treeseed',
		inventorySource,
		seedPath: typeof inventory.path === 'string' && inventory.path.trim() ? inventory.path.trim() : 'seeds/treeseed.yaml',
	};
}

export function assertMarketIntegrationEnabled(cwd: string, profileId: string) {
	if (profileId === 'treeseed' && !resolveMarketIntegrationMode(cwd).enabled) {
		throw new MarketIntegrationDisabledError();
	}
}
