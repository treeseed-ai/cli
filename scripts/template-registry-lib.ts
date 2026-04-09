import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { cliPackageVersion, corePackageVersion, marketPackageRoot } from './paths.ts';

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
	schemaVersion?: number;
	id: string;
	displayName: string;
	description: string;
	category: TemplateCategory;
	tags: string[];
	templateVersion?: string;
	templateApiVersion: number;
	minCliVersion: string;
	minCoreVersion?: string;
	variables: TemplateVariableDefinition[];
	actions?: string[];
	postCreate?: string[];
	managedSurface?: {
		coreManaged?: string[];
		validatedOnly?: string[];
		tenantManaged?: string[];
	};
	testing: {
		smokeCommand?: string;
		buildCommand?: string;
	};
}

export interface TemplateProductDefinition {
	id: string;
	displayName: string;
	description: string;
	summary: string;
	status: 'draft' | 'live' | 'archived';
	featured?: boolean;
	category: TemplateCategory;
	audience?: string[];
	tags?: string[];
	publisher: {
		id: string;
		name: string;
		url?: string;
	};
	publisherVerified?: boolean;
	templateVersion: string;
	templateApiVersion: number;
	minCliVersion: string;
	minCoreVersion: string;
	fulfillment: {
		source: {
			kind: 'git';
			repoUrl: string;
			directory: string;
			ref: string;
			integrity?: string;
		};
		hooksPolicy: 'builtin_only' | 'trusted_only' | 'disabled';
		supportsReconcile: boolean;
	};
	offer?: {
		priceModel?: 'free' | 'paid' | 'contact';
		license?: string;
		support?: string;
	};
	relatedBooks?: string[];
	relatedKnowledge?: string[];
	relatedObjectives?: string[];
	contentPath: string;
	artifactRoot: string;
	artifactManifestPath: string;
	templateRoot: string;
}

export interface ResolvedTemplateDefinition {
	product: TemplateProductDefinition;
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

interface TemplateState {
	templateId: string;
	templateVersion?: string;
	sourceRef?: string;
	installedAt: string;
	lastSyncedAt?: string;
	replacements: Record<string, string>;
}

const marketContentTemplatesRoot = resolve(marketPackageRoot, 'src', 'content', 'templates');
const marketArtifactsRoot = resolve(marketPackageRoot, 'templates');

function loadJsonFile<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function ensureDir(filePath: string) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function readFrontmatter(filePath: string) {
	const raw = readFileSync(filePath, 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		throw new Error(`Template product is missing frontmatter: ${filePath}`);
	}
	return parseYaml(match[1]) as Record<string, unknown>;
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

function listMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	return listFiles(root).filter((filePath) => filePath.endsWith('.md') || filePath.endsWith('.mdx'));
}

function validateTemplateProductShape(product: TemplateProductDefinition) {
	if (!product.id || !product.displayName || !product.description || !product.summary) {
		throw new Error(`Template product ${product.contentPath} is missing required identity metadata.`);
	}
	if (!TEMPLATE_CATEGORIES.includes(product.category)) {
		throw new Error(`Template product ${product.id} uses unsupported category "${product.category}".`);
	}
	if (product.status !== 'draft' && product.status !== 'live' && product.status !== 'archived') {
		throw new Error(`Template product ${product.id} uses unsupported status "${product.status}".`);
	}
	if (!existsSync(product.artifactManifestPath)) {
		throw new Error(`Template product ${product.id} points to a missing artifact manifest: ${product.artifactManifestPath}`);
	}
	if (!existsSync(product.templateRoot)) {
		throw new Error(`Template product ${product.id} points to a missing template payload: ${product.templateRoot}`);
	}
}

function validateTemplateManifest(definition: ResolvedTemplateDefinition) {
	const { manifest, templateRoot, manifestPath, product } = definition;
	if (!TEMPLATE_CATEGORIES.includes(manifest.category)) {
		throw new Error(`Invalid template category in ${manifestPath}: ${manifest.category}`);
	}
	if (!manifest.id || !manifest.displayName || !manifest.description) {
		throw new Error(`Template manifest ${manifestPath} is missing required metadata fields.`);
	}
	if (manifest.id !== product.id) {
		throw new Error(`Template product ${product.id} does not match artifact id ${manifest.id}.`);
	}
	if (!existsSync(templateRoot)) {
		throw new Error(`Template ${manifest.id} is missing template/ at ${templateRoot}.`);
	}
	validateTemplatePlaceholders(definition);
}

function isTextFile(filePath: string) {
	return !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz)$/iu.test(filePath);
}

function validateTemplatePlaceholders(definition: ResolvedTemplateDefinition) {
	const declaredTokens = new Set(definition.manifest.variables.map((variable) => variable.token));
	const discoveredTokens = new Set<string>();
	for (const filePath of listFiles(definition.templateRoot)) {
		if (!isTextFile(filePath)) {
			continue;
		}
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

function parseTemplateProduct(filePath: string): TemplateProductDefinition {
	const frontmatter = readFrontmatter(filePath);
	const slug = String(frontmatter.slug ?? '');
	const fulfillment = (frontmatter.fulfillment ?? {}) as Record<string, unknown>;
	const source = (fulfillment.source ?? {}) as Record<string, unknown>;
	const artifactRoot = resolve(marketPackageRoot, String(source.directory ?? ''));
	const product: TemplateProductDefinition = {
		id: slug,
		displayName: String(frontmatter.title ?? ''),
		description: String(frontmatter.description ?? ''),
		summary: String(frontmatter.summary ?? ''),
		status: String(frontmatter.status ?? 'draft') as TemplateProductDefinition['status'],
		featured: Boolean(frontmatter.featured),
		category: String(frontmatter.category ?? '') as TemplateCategory,
		audience: Array.isArray(frontmatter.audience) ? frontmatter.audience.map(String) : [],
		tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
		publisher: {
			id: String((frontmatter.publisher as Record<string, unknown> | undefined)?.id ?? ''),
			name: String((frontmatter.publisher as Record<string, unknown> | undefined)?.name ?? ''),
			url: typeof (frontmatter.publisher as Record<string, unknown> | undefined)?.url === 'string'
				? String((frontmatter.publisher as Record<string, unknown>).url)
				: undefined,
		},
		publisherVerified: Boolean(frontmatter.publisherVerified),
		templateVersion: String(frontmatter.templateVersion ?? ''),
		templateApiVersion: Number(frontmatter.templateApiVersion ?? 0),
		minCliVersion: String(frontmatter.minCliVersion ?? ''),
		minCoreVersion: String(frontmatter.minCoreVersion ?? ''),
		fulfillment: {
			source: {
				kind: 'git',
				repoUrl: String(source.repoUrl ?? ''),
				directory: String(source.directory ?? ''),
				ref: String(source.ref ?? ''),
				integrity: typeof source.integrity === 'string' ? source.integrity : undefined,
			},
			hooksPolicy: String(fulfillment.hooksPolicy ?? 'builtin_only') as TemplateProductDefinition['fulfillment']['hooksPolicy'],
			supportsReconcile: Boolean(fulfillment.supportsReconcile ?? true),
		},
		offer: typeof frontmatter.offer === 'object' && frontmatter.offer !== null
			? {
				priceModel: typeof (frontmatter.offer as Record<string, unknown>).priceModel === 'string'
					? (frontmatter.offer as Record<string, unknown>).priceModel as 'free' | 'paid' | 'contact'
					: undefined,
				license: typeof (frontmatter.offer as Record<string, unknown>).license === 'string'
					? String((frontmatter.offer as Record<string, unknown>).license)
					: undefined,
				support: typeof (frontmatter.offer as Record<string, unknown>).support === 'string'
					? String((frontmatter.offer as Record<string, unknown>).support)
					: undefined,
			}
			: undefined,
		relatedBooks: Array.isArray(frontmatter.relatedBooks) ? frontmatter.relatedBooks.map(String) : [],
		relatedKnowledge: Array.isArray(frontmatter.relatedKnowledge) ? frontmatter.relatedKnowledge.map(String) : [],
		relatedObjectives: Array.isArray(frontmatter.relatedObjectives) ? frontmatter.relatedObjectives.map(String) : [],
		contentPath: filePath,
		artifactRoot,
		artifactManifestPath: resolve(artifactRoot, 'template.config.json'),
		templateRoot: resolve(artifactRoot, 'template'),
	};
	validateTemplateProductShape(product);
	return product;
}

function loadTemplateState(siteRoot: string): TemplateState {
	const statePath = resolve(siteRoot, '.treeseed', 'template-state.json');
	if (!existsSync(statePath)) {
		throw new Error(`Template state is missing at ${statePath}. This site may not have been created from a market template.`);
	}
	return loadJsonFile<TemplateState>(statePath);
}

function writeTemplateState(siteRoot: string, state: TemplateState) {
	const statePath = resolve(siteRoot, '.treeseed', 'template-state.json');
	ensureDir(statePath);
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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

function applyReplacements(source: string, replacements: Record<string, string>) {
	let output = source;
	for (const [token, value] of Object.entries(replacements)) {
		output = output.split(token).join(value);
	}
	return output;
}

function renderTemplateFile(filePath: string, replacements: Record<string, string>) {
	return applyReplacements(readFileSync(filePath, 'utf8'), replacements);
}

function copyTemplateTree(templateRoot: string, targetRoot: string, replacements: Record<string, string>) {
	for (const filePath of listFiles(templateRoot)) {
		const relativePath = relative(templateRoot, filePath);
		const outputPath = resolve(targetRoot, relativePath);
		ensureDir(outputPath);
		if (isTextFile(filePath)) {
			writeFileSync(outputPath, renderTemplateFile(filePath, replacements), 'utf8');
			continue;
		}
		cpSync(filePath, outputPath, { recursive: false });
	}
}

function syncManagedPackageJson(targetPath: string, sourcePath: string, replacements: Record<string, string>, check: boolean) {
	const currentJson = existsSync(targetPath) ? loadJsonFile<Record<string, unknown>>(targetPath) : {};
	const templateJson = JSON.parse(renderTemplateFile(sourcePath, replacements)) as Record<string, unknown>;
	const nextJson = {
		...currentJson,
		type: templateJson.type ?? currentJson.type,
		scripts: typeof templateJson.scripts === 'object' && templateJson.scripts !== null
			? { ...(currentJson.scripts as Record<string, unknown> | undefined ?? {}), ...(templateJson.scripts as Record<string, unknown>) }
			: currentJson.scripts,
		dependencies: {
			...(currentJson.dependencies as Record<string, unknown> | undefined ?? {}),
			...Object.fromEntries(
				Object.entries((templateJson.dependencies as Record<string, unknown> | undefined) ?? {}).filter(([name]) => name.startsWith('@treeseed/')),
			),
		},
	};
	const currentSerialized = `${JSON.stringify(currentJson, null, 2)}\n`;
	const nextSerialized = `${JSON.stringify(nextJson, null, 2)}\n`;
	if (currentSerialized === nextSerialized) {
		return false;
	}
	if (!check) {
		writeFileSync(targetPath, nextSerialized, 'utf8');
	}
	return true;
}

function validateYamlFile(filePath: string) {
	parseYaml(readFileSync(filePath, 'utf8'));
}

export function listTemplateProducts() {
	return listMarkdownFiles(marketContentTemplatesRoot)
		.map(parseTemplateProduct)
		.sort((left, right) => {
			const featuredDiff = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
			if (featuredDiff !== 0) {
				return featuredDiff;
			}
			return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
		});
}

export function resolveTemplateProduct(id: string) {
	const product = listTemplateProducts().find((entry) => entry.id === id);
	if (!product) {
		throw new Error(`Unable to resolve market template product "${id}".`);
	}
	return product;
}

export function resolveTemplateDefinition(id: string, category?: TemplateCategory): ResolvedTemplateDefinition {
	const product = resolveTemplateProduct(id);
	if (category && product.category !== category) {
		throw new Error(`Unable to resolve template "${id}" in category "${category}".`);
	}
	const manifest = loadJsonFile<TemplateManifest>(product.artifactManifestPath);
	const definition = {
		product,
		manifestPath: product.artifactManifestPath,
		templateRoot: product.templateRoot,
		manifest,
	};
	validateTemplateManifest(definition);
	return definition;
}

export function validateTemplateProduct(product: TemplateProductDefinition) {
	validateTemplateProductShape(product);
	const definition = resolveTemplateDefinition(product.id);
	if (definition.manifest.templateApiVersion !== product.templateApiVersion) {
		throw new Error(`Template product ${product.id} and artifact templateApiVersion do not match.`);
	}
	if ((definition.manifest.templateVersion ?? '') && definition.manifest.templateVersion !== product.templateVersion) {
		throw new Error(`Template product ${product.id} and artifact templateVersion do not match.`);
	}
	if (definition.manifest.minCliVersion !== product.minCliVersion) {
		throw new Error(`Template product ${product.id} and artifact minCliVersion do not match.`);
	}
	if ((definition.manifest.minCoreVersion ?? '') && definition.manifest.minCoreVersion !== product.minCoreVersion) {
		throw new Error(`Template product ${product.id} and artifact minCoreVersion do not match.`);
	}
	return definition;
}

export function validateAllTemplateDefinitions() {
	return listTemplateProducts().map(validateTemplateProduct);
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

export function scaffoldTemplateProject(templateId: string, targetRoot: string, input: StarterResolutionInput) {
	const definition = resolveTemplateDefinition(templateId);
	const replacements = buildTemplateReplacements(definition.manifest, {
		...input,
		target: basename(targetRoot),
	});
	copyTemplateTree(definition.templateRoot, targetRoot, replacements);
	writeTemplateState(targetRoot, {
		templateId: definition.product.id,
		templateVersion: definition.product.templateVersion,
		sourceRef: definition.product.fulfillment.source.ref,
		installedAt: new Date().toISOString(),
		lastSyncedAt: new Date().toISOString(),
		replacements,
	});
	return definition.product;
}

export function syncTemplateProject(siteRoot: string, options: { check?: boolean } = {}) {
	const check = options.check === true;
	const state = loadTemplateState(siteRoot);
	const definition = resolveTemplateDefinition(state.templateId);
	const managedSurface = definition.manifest.managedSurface ?? {};
	const changes: string[] = [];

	for (const relativePath of managedSurface.coreManaged ?? []) {
		const targetPath = resolve(siteRoot, relativePath);
		const sourcePath = resolve(definition.templateRoot, relativePath);
		if (!existsSync(sourcePath)) {
			throw new Error(`Managed template file is missing from artifact: ${relativePath}`);
		}

		if (relativePath === 'package.json') {
			if (syncManagedPackageJson(targetPath, sourcePath, state.replacements, check)) {
				changes.push(relativePath);
			}
			continue;
		}

		const nextContent = renderTemplateFile(sourcePath, state.replacements);
		const currentContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
		if (currentContent === nextContent) {
			continue;
		}
		if (!check) {
			ensureDir(targetPath);
			writeFileSync(targetPath, nextContent, 'utf8');
		}
		changes.push(relativePath);
	}

	for (const relativePath of managedSurface.validatedOnly ?? []) {
		const targetPath = resolve(siteRoot, relativePath);
		if (!existsSync(targetPath)) {
			throw new Error(`Validated file is missing from generated site: ${relativePath}`);
		}
		validateYamlFile(targetPath);
	}

	if (!check) {
		writeTemplateState(siteRoot, {
			...state,
			templateVersion: definition.product.templateVersion,
			sourceRef: definition.product.fulfillment.source.ref,
			lastSyncedAt: new Date().toISOString(),
		});
	}

	return changes;
}

export function serializeTemplateRegistryEntry(product: TemplateProductDefinition) {
	return {
		id: product.id,
		displayName: product.displayName,
		description: product.description,
		summary: product.summary,
		status: product.status,
		featured: Boolean(product.featured),
		category: product.category,
		tags: product.tags ?? [],
		publisher: product.publisher,
		templateVersion: product.templateVersion,
		templateApiVersion: product.templateApiVersion,
		minCliVersion: product.minCliVersion,
		minCoreVersion: product.minCoreVersion,
		source: product.fulfillment.source,
	};
}

export function exportTemplateCatalogYaml() {
	return stringifyYaml(listTemplateProducts().map(serializeTemplateRegistryEntry));
}
