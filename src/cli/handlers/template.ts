import type { TreeseedCommandHandler } from '../types.js';
import { TreeseedOperationsSdk } from '@treeseed/sdk/operations';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	listIntegratedMarketCatalog,
	resolveIntegratedCatalogArtifactDownload,
	verifyArtifactBytes,
} from '@treeseed/sdk/market-client';
import { guidedResult } from './utils.js';
import { marketAuthRoot, marketSelector } from './market-utils.js';

const operations = new TreeseedOperationsSdk();

export const handleTemplate: TreeseedCommandHandler = async (invocation, context) => {
	if (invocation.positionals[0] === 'search' || invocation.positionals[0] === 'install' || typeof invocation.args.market === 'string') {
		const action = invocation.positionals[0] ?? 'search';
		const selector = marketSelector(invocation);
		const authRoot = marketAuthRoot(context);
		if (action === 'search' || action === 'list') {
			const response = await listIntegratedMarketCatalog({
				kind: 'template',
				selector,
				authRoot,
				userAgent: 'treeseed-cli',
			});
			return guidedResult({
				command: 'template',
				summary: selector ? 'Treeseed market templates' : 'Treeseed integrated market templates',
				sections: [{
					title: 'Templates',
					lines: response.payload.map((template: any) =>
						`${template.id}  ${template.title ?? template.displayName ?? template.slug}  market=${template.sourceMarket.label ?? template.sourceMarket.id}`),
				}],
				report: { selector, templates: response.payload, errors: response.errors },
			});
		}
		if (action === 'install') {
			const itemId = invocation.positionals[1];
			const version = typeof invocation.args.version === 'string' ? invocation.args.version : '1.0.0';
			if (!itemId) return { exitCode: 1, stderr: ['Usage: treeseed template install <item-id> [--version <version>]'] };
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
			const outputPath = resolve(outputDir, `template-${response.payload.slug ?? itemId}-${response.payload.version}.tar`.replace(/[^A-Za-z0-9._-]+/g, '-'));
			writeFileSync(outputPath, bytes);
			return guidedResult({
				command: 'template',
				summary: 'Downloaded template artifact.',
				facts: [
					{ label: 'Market', value: response.payload.sourceMarket.label ?? response.payload.sourceMarket.id },
					{ label: 'Template', value: response.payload.slug ?? itemId },
					{ label: 'Version', value: response.payload.version },
					{ label: 'Path', value: outputPath },
				],
				report: { marketId: response.payload.sourceMarket.id, artifact: response.payload, outputPath },
			});
		}
	}
	const result = await operations.execute({
		operationName: 'template',
		input: {
			action: invocation.positionals[0],
			id: invocation.positionals[1],
		},
	}, {
		cwd: context.cwd,
		env: context.env,
		write: context.write,
		spawn: context.spawn,
		outputFormat: context.outputFormat,
		transport: 'cli',
	});
	return {
		exitCode: result.exitCode ?? (result.ok ? 0 : 1),
		stdout: result.stdout,
		stderr: result.stderr,
		report: result.payload as Record<string, unknown> | null,
	};
};
