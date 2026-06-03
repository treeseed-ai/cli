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

function requirementStatus(required: unknown) {
	return required === true ? 'required' : 'optional';
}

function providerList(requirement: Record<string, any>) {
	return Array.isArray(requirement.compatibleProviders) && requirement.compatibleProviders.length > 0
		? requirement.compatibleProviders.join(', ')
		: 'any provider';
}

function renderLaunchRequirementSections(template: Record<string, any>) {
	const launchRequirements = template.launchRequirements as Record<string, any> | undefined;
	if (!launchRequirements) {
		return [{ title: 'Launch Requirements', lines: ['No launch requirements declared.'] }];
	}
	const hosts = Array.isArray(launchRequirements.hosts) ? launchRequirements.hosts as Array<Record<string, any>> : [];
	const resources = Array.isArray(launchRequirements.resources) ? launchRequirements.resources as Array<Record<string, any>> : [];
	const secrets = Array.isArray(launchRequirements.secrets) ? launchRequirements.secrets as Array<Record<string, any>> : [];
	const configurableRequirements = [...hosts, ...resources];
	const configWrites = configurableRequirements.flatMap((requirement) => Array.isArray(requirement.configWrites)
		? requirement.configWrites.map((write: Record<string, any>) => `${requirement.key}: ${write.target}.${write.path} <- ${write.valueFrom}${write.writeWhen ? ` (${write.writeWhen})` : ''}`)
		: []);
	const environmentWrites = configurableRequirements.flatMap((requirement) => Array.isArray(requirement.environmentWrites)
		? requirement.environmentWrites.map((write: Record<string, any>) => `${requirement.key}: ${write.env} -> ${(write.targets ?? []).join(', ') || 'config'} [${(write.scopes ?? []).join(', ') || 'template scopes'}]`)
		: []);
	return [
		{
			title: 'Required Hosts',
			lines: hosts
				.filter((host) => host.required === true)
				.map((host) => `${host.key}: ${host.type} via ${providerList(host)} - ${host.purpose ?? host.displayName}`),
		},
		{
			title: 'Optional Hosts',
			lines: hosts
				.filter((host) => host.required !== true)
				.map((host) => `${host.key}: ${host.type} via ${providerList(host)} - ${host.purpose ?? host.displayName}`),
		},
		{
			title: 'Resources',
			lines: resources.length > 0
				? resources.map((resource) => `${resource.key}: ${resource.type} ${requirementStatus(resource.required)} via ${providerList(resource)}`)
				: ['No resource lifecycle requirements in this phase.'],
		},
		{
			title: 'Secrets',
			lines: secrets.length > 0
				? secrets.map((secret) => `${secret.key}: ${secret.env} ${requirementStatus(secret.required)} -> ${(secret.targets ?? []).join(', ')}`)
				: ['No standalone secret requirements declared.'],
		},
		{
			title: 'Config Writes',
			lines: configWrites.length > 0 ? configWrites : ['No config writes declared.'],
		},
		{
			title: 'Environment Targets',
			lines: environmentWrites.length > 0 ? environmentWrites : ['No host-derived environment targets declared.'],
		},
	].filter((section) => section.lines.length > 0);
}

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
	if (context.outputFormat === 'json' || !result.ok) {
		return {
			exitCode: result.exitCode ?? (result.ok ? 0 : 1),
			stdout: result.stdout,
			stderr: result.stderr,
			report: result.payload as Record<string, unknown> | null,
		};
	}
	const payload = result.payload as Record<string, any> | null;
	if (payload?.action === 'show' && payload.template) {
		const template = payload.template as Record<string, any>;
		return guidedResult({
			command: 'template',
			summary: `Template ${template.id} is ready to scaffold.`,
			facts: [
				{ label: 'Name', value: template.displayName ?? template.id },
				{ label: 'Status', value: template.status ?? '(unknown)' },
				{ label: 'Version', value: template.templateVersion ?? '(unversioned)' },
				{ label: 'Fulfillment', value: template.fulfillmentMode ?? '(unknown)' },
			],
			sections: renderLaunchRequirementSections(template),
			report: payload,
		});
	}
	if (payload?.action === 'list' && Array.isArray(payload.templates)) {
		return guidedResult({
			command: 'template',
			summary: 'Treeseed starter templates',
			sections: [{
				title: 'Templates',
				lines: payload.templates.map((template: Record<string, any>) =>
					`${template.id}  ${template.displayName ?? template.id}  ${template.status ?? 'unknown'}`),
			}],
			report: payload,
		});
	}
	if (payload?.action === 'validate') {
		return guidedResult({
			command: 'template',
			summary: 'Template validation completed.',
			sections: [{
				title: 'Validated',
				lines: Array.isArray(payload.validated) ? payload.validated.map(String) : [],
			}],
			report: payload,
		});
	}
	return {
		exitCode: result.exitCode ?? (result.ok ? 0 : 1),
		stdout: result.stdout,
		stderr: result.stderr,
		report: result.payload as Record<string, unknown> | null,
	};
};
