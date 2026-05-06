import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	listIntegratedMarketCatalog,
	resolveIntegratedCatalogArtifactDownload,
	verifyArtifactBytes,
} from '@treeseed/sdk/market-client';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { marketAuthRoot, marketSelector } from './market-utils.js';

function artifactFileName(kind: string, slug: string, version: string) {
	return `${kind}-${slug}-${version}.tar`.replace(/[^A-Za-z0-9._-]+/g, '-');
}

export const handlePacks: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'search';
	const selector = marketSelector(invocation);
	const authRoot = marketAuthRoot(context);
	if (action === 'search' || action === 'list') {
		const response = await listIntegratedMarketCatalog({
			kind: 'knowledge_pack',
			selector,
			authRoot,
			userAgent: 'treeseed-cli',
		});
		return guidedResult({
			command: 'packs',
			summary: selector ? 'Treeseed knowledge packs' : 'Treeseed integrated knowledge packs',
			sections: [{
				title: 'Packs',
				lines: response.payload.map((pack: any) =>
					`${pack.id}  ${pack.title ?? pack.name ?? pack.slug}  market=${pack.sourceMarket.label ?? pack.sourceMarket.id}`),
			}],
			report: { selector, packs: response.payload, errors: response.errors },
		});
	}
	if (action === 'install') {
		const itemId = invocation.positionals[1];
		const version = typeof invocation.args.version === 'string' ? invocation.args.version : '1.0.0';
		if (!itemId) return { exitCode: 1, stderr: ['Usage: treeseed packs install <item-id> [--version <version>]'] };
		const response = await resolveIntegratedCatalogArtifactDownload({
			itemId,
			version,
			selector,
			authRoot,
			userAgent: 'treeseed-cli',
		});
		const download = await fetch(response.payload.downloadUrl);
		if (!download.ok) {
			return { exitCode: 1, stderr: [`Artifact download failed with ${download.status}.`] };
		}
		const bytes = await verifyArtifactBytes(download, response.payload.sha256);
		const outputDir = resolve(context.cwd, '.treeseed', 'downloads');
		mkdirSync(outputDir, { recursive: true });
		const outputPath = resolve(outputDir, artifactFileName(response.payload.kind, response.payload.slug ?? itemId, response.payload.version));
		writeFileSync(outputPath, bytes);
		return guidedResult({
			command: 'packs',
			summary: 'Downloaded knowledge pack artifact.',
			facts: [
				{ label: 'Market', value: response.payload.sourceMarket.label ?? response.payload.sourceMarket.id },
				{ label: 'Pack', value: response.payload.slug ?? itemId },
				{ label: 'Version', value: response.payload.version },
				{ label: 'Path', value: outputPath },
			],
			report: { marketId: response.payload.sourceMarket.id, artifact: response.payload, outputPath },
		});
	}
	return { exitCode: 1, stderr: [`Unknown packs action: ${action}`] };
};
