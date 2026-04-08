import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cliPackageVersion, corePackageVersion, examplesRoot, fixturesRoot, referenceAppsRoot, templatesRoot } from './paths.ts';

export const TEMPLATE_CATEGORIES = ['starter', 'example', 'fixture', 'reference-app'] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateVariableDefinition {
	name: string;
	token: string;
	deriveFrom?: string;
	required?: boolean;
	default?: string;
}

export interface TemplateManifest {
	id: string;
	displayName: string;
	description: string;
	category: TemplateCategory;
	tags: string[];
	templateApiVersion: number;
	minCliVersion: string;
	variables: TemplateVariableDefinition[];
	postCreate: string[];
	testing: {
		smokeCommand?: string;
		buildCommand?: string;
	};
}

export interface ResolvedTemplateDefinition {
	root: string;
	manifestPath: string;
	templateRoot: string;
	manifest: TemplateManifest;
}

export interface StarterResolutionInput {
	target: string;
	name?: string | null;
	slug?: string | null;
	siteUrl?: string | null;
	contactEmail?: string | null;
	repositoryUrl?: string | null;
	discordUrl?: string | null;
}

function loadJsonFile<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function listTemplateRoots(baseRoot: string) {
	if (!existsSync(baseRoot)) {
		return [];
	}
	return readdirSync(baseRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => resolve(baseRoot, entry.name))
		.filter((root) => existsSync(resolve(root, 'template.config.json')));
}

function validateTemplateManifest(definition: ResolvedTemplateDefinition) {
	const { manifest, templateRoot, manifestPath } = definition;
	if (!TEMPLATE_CATEGORIES.includes(manifest.category)) {
		throw new Error(`Invalid template category in ${manifestPath}: ${manifest.category}`);
	}
	if (!manifest.id || !manifest.displayName || !manifest.description) {
		throw new Error(`Template manifest ${manifestPath} is missing required metadata fields.`);
	}
	if (!existsSync(templateRoot)) {
		throw new Error(`Template ${manifest.id} is missing template/ at ${templateRoot}.`);
	}
	validateTemplatePlaceholders(definition);
}

function listFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = resolve(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

function validateTemplatePlaceholders(definition: ResolvedTemplateDefinition) {
	const declaredTokens = new Set(definition.manifest.variables.map((variable) => variable.token));
	const discoveredTokens = new Set<string>();
	for (const filePath of listFiles(definition.templateRoot)) {
		const contents = readFileSync(filePath, 'utf8');
		for (const match of contents.matchAll(/__[A-Z0-9_]+__/g)) {
			discoveredTokens.add(match[0]);
		}
	}
	for (const token of discoveredTokens) {
		if (!declaredTokens.has(token)) {
			throw new Error(`Template ${definition.manifest.id} uses undeclared token ${token}.`);
		}
	}
}

export function resolveTemplateDefinition(id: string, category?: TemplateCategory): ResolvedTemplateDefinition {
	const roots = [...listTemplateRoots(templatesRoot), ...listTemplateRoots(fixturesRoot), ...listTemplateRoots(examplesRoot), ...listTemplateRoots(referenceAppsRoot)];
	for (const root of roots) {
		const manifestPath = resolve(root, 'template.config.json');
		const manifest = loadJsonFile<TemplateManifest>(manifestPath);
		if (manifest.id !== id) {
			continue;
		}
		if (category && manifest.category !== category) {
			continue;
		}
		const definition = {
			root,
			manifestPath,
			templateRoot: resolve(root, 'template'),
			manifest,
		};
		validateTemplateManifest(definition);
		return definition;
	}
	throw new Error(`Unable to resolve template "${id}"${category ? ` in category "${category}"` : ''}.`);
}

export function validateAllTemplateDefinitions() {
	const roots = [...listTemplateRoots(templatesRoot), ...listTemplateRoots(fixturesRoot), ...listTemplateRoots(examplesRoot), ...listTemplateRoots(referenceAppsRoot)];
	return roots.map((root) => {
		const definition = {
			root,
			manifestPath: resolve(root, 'template.config.json'),
			templateRoot: resolve(root, 'template'),
			manifest: loadJsonFile<TemplateManifest>(resolve(root, 'template.config.json')),
		};
		validateTemplateManifest(definition);
		return definition;
	});
}

function toTitleCase(value: string) {
	return value
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function inferSlug(target: string, explicitSlug?: string | null) {
	return (explicitSlug ?? target).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

function inferName(target: string, explicitName?: string | null) {
	return explicitName ?? toTitleCase(target);
}

function resolveVariableValue(variable: TemplateVariableDefinition, input: StarterResolutionInput) {
	switch (variable.deriveFrom) {
		case 'slug':
			return inferSlug(input.target, input.slug);
		case 'name':
			return inferName(input.target, input.name);
		case 'siteUrl':
			return input.siteUrl ?? variable.default ?? '';
		case 'contactEmail':
			return input.contactEmail ?? variable.default ?? '';
		case 'repositoryUrl':
			return input.repositoryUrl ?? variable.default ?? '';
		case 'discordUrl':
			return input.discordUrl ?? variable.default ?? '';
		case 'cliVersion':
			return `^${cliPackageVersion}`;
		case 'coreVersion':
			return `^${corePackageVersion}`;
		default:
			return variable.default ?? '';
	}
}

export function buildTemplateReplacements(manifest: TemplateManifest, input: StarterResolutionInput) {
	const replacements: Record<string, string> = {};
	for (const variable of manifest.variables) {
		const value = resolveVariableValue(variable, input);
		if (variable.required && !value) {
			throw new Error(`Template "${manifest.id}" requires a value for "${variable.name}".`);
		}
		replacements[variable.token] = value;
	}
	return replacements;
}
