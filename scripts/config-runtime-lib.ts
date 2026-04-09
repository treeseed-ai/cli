import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	getTreeseedEnvironmentSuggestedValues,
	resolveTreeseedEnvironmentRegistry,
	TREESEED_ENVIRONMENT_SCOPES,
	validateTreeseedEnvironmentValues,
} from '@treeseed/core/environment';
import { loadTreeseedManifest } from '@treeseed/core/tenant-config';
import {
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	markDeploymentInitialized,
	provisionCloudflareResources,
	syncCloudflareSecrets,
} from './deploy-lib.ts';
import { maybeResolveGitHubRepositorySlug } from './github-automation-lib.ts';
import { loadCliDeployConfig, withProcessCwd } from './package-tools.ts';

const MACHINE_CONFIG_RELATIVE_PATH = '.treeseed/config/machine.yaml';
const MACHINE_KEY_RELATIVE_PATH = '.treeseed/config/machine.key';
const TEMPLATE_CATALOG_CACHE_RELATIVE_PATH = 'treeseed/cache/template-catalog.json';
const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';
export const DEFAULT_TEMPLATE_CATALOG_URL = 'https://api.treeseed.ai/search/templates';
export const TREESEED_TEMPLATE_CATALOG_URL_ENV = 'TREESEED_TEMPLATE_CATALOG_URL';

function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function parseEnvFile(contents) {
	return contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'))
		.reduce((acc, line) => {
			const separatorIndex = line.indexOf('=');
			if (separatorIndex === -1) {
				return acc;
			}
			acc[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1);
			return acc;
		}, {});
}

function readEnvFileIfPresent(filePath) {
	if (!existsSync(filePath)) {
		return {};
	}
	return parseEnvFile(readFileSync(filePath, 'utf8'));
}

function maskValue(value) {
	if (!value) {
		return '(unset)';
	}
	if (value.length <= 8) {
		return '********';
	}
	return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function writeDeploySummary(write, summary) {
	write('Treeseed deployment summary');
	write(`  Target: ${summary.target}`);
	write(`  Worker: ${summary.workerName}`);
	write(`  Site URL: ${summary.siteUrl}`);
	write(`  Account ID: ${summary.accountId}`);
	write(`  D1: ${summary.siteDataDb.databaseName} (${summary.siteDataDb.databaseId})`);
	write(`  KV FORM_GUARD_KV: ${summary.formGuardKv.id}`);
	write(`  KV SESSION: ${summary.sessionKv.id}`);
}

function loadTenantDeployConfig(tenantRoot) {
	return loadCliDeployConfig(tenantRoot);
}

function loadOptionalTenantManifest(tenantRoot) {
	try {
		return withProcessCwd(tenantRoot, () => loadTreeseedManifest());
	} catch {
		return undefined;
	}
}

function findNearestTreeseedMachineConfig(startRoot = process.cwd()) {
	let current = resolve(startRoot);

	while (true) {
		const configPath = resolve(current, MACHINE_CONFIG_RELATIVE_PATH);
		if (existsSync(configPath)) {
			return configPath;
		}

		const parent = resolve(current, '..');
		if (parent === current) {
			break;
		}
		current = parent;
	}

	return null;
}

export function getTreeseedMachineConfigPaths(tenantRoot) {
	return {
		configPath: resolve(tenantRoot, MACHINE_CONFIG_RELATIVE_PATH),
		keyPath: resolve(tenantRoot, MACHINE_KEY_RELATIVE_PATH),
	};
}

export function createDefaultTreeseedMachineConfig({ tenantRoot, deployConfig, tenantConfig }) {
	return {
		version: 1,
		project: {
			tenantRoot,
			tenantId: tenantConfig?.id ?? deployConfig.slug,
			slug: deployConfig.slug,
			name: deployConfig.name,
			siteUrl: deployConfig.siteUrl,
			overlayPath: resolve(tenantRoot, TENANT_ENVIRONMENT_OVERLAY_PATH),
		},
		settings: {
			sync: {
				github: true,
				cloudflare: true,
			},
			templates: {
				catalogEndpoint: DEFAULT_TEMPLATE_CATALOG_URL,
			},
		},
		environments: Object.fromEntries(
			TREESEED_ENVIRONMENT_SCOPES.map((scope) => [
				scope,
				{
					values: {},
					secrets: {},
				},
			]),
		),
	};
}

function loadMachineKey(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (existsSync(keyPath)) {
		return Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
	}

	const key = randomBytes(32);
	ensureParent(keyPath);
	writeFileSync(keyPath, `${key.toString('base64')}\n`, { mode: 0o600 });
	return key;
}

function encryptValue(value, key) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		algorithm: 'aes-256-gcm',
		iv: iv.toString('base64'),
		tag: tag.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
	};
}

function decryptValue(payload, key) {
	if (!payload || typeof payload !== 'object') {
		return '';
	}

	const decipher = createDecipheriv(
		'aes-256-gcm',
		key,
		Buffer.from(String(payload.iv ?? ''), 'base64'),
	);
	decipher.setAuthTag(Buffer.from(String(payload.tag ?? ''), 'base64'));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(String(payload.ciphertext ?? ''), 'base64')),
		decipher.final(),
	]);
	return decrypted.toString('utf8');
}

export function loadTreeseedMachineConfig(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const tenantConfig = loadOptionalTenantManifest(tenantRoot);
	const defaults = createDefaultTreeseedMachineConfig({ tenantRoot, deployConfig, tenantConfig });
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);

	if (!existsSync(configPath)) {
		return defaults;
	}

	const raw = parseYaml(readFileSync(configPath, 'utf8')) ?? {};
	const parsed = raw && typeof raw === 'object' ? raw : {};
	return {
		...defaults,
		...parsed,
		project: {
			...defaults.project,
			...(parsed.project ?? {}),
		},
		settings: {
			...defaults.settings,
			...(parsed.settings ?? {}),
			sync: {
				...defaults.settings.sync,
				...(parsed.settings?.sync ?? {}),
			},
			templates: {
				...(defaults.settings.templates ?? {}),
				...(parsed.settings?.templates ?? {}),
			},
		},
		environments: Object.fromEntries(
			TREESEED_ENVIRONMENT_SCOPES.map((scope) => [
				scope,
				{
					values: {
						...(defaults.environments?.[scope]?.values ?? {}),
						...(parsed.environments?.[scope]?.values ?? {}),
					},
					secrets: {
						...(defaults.environments?.[scope]?.secrets ?? {}),
						...(parsed.environments?.[scope]?.secrets ?? {}),
					},
				},
			]),
		),
	};
}

export function writeTreeseedMachineConfig(tenantRoot, config) {
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);
	ensureParent(configPath);
	writeFileSync(configPath, stringifyYaml(config), 'utf8');
}

export function resolveTreeseedTemplateCatalogEndpoint(startRoot = process.cwd(), env = process.env) {
	const envValue = env[TREESEED_TEMPLATE_CATALOG_URL_ENV];
	if (typeof envValue === 'string' && envValue.trim().length > 0) {
		return envValue.trim();
	}

	const machineConfigPath = findNearestTreeseedMachineConfig(startRoot);
	if (!machineConfigPath) {
		return DEFAULT_TEMPLATE_CATALOG_URL;
	}

	const raw = parseYaml(readFileSync(machineConfigPath, 'utf8')) ?? {};
	const parsed = raw && typeof raw === 'object' ? raw : {};
	const configuredEndpoint = parsed.settings?.templates?.catalogEndpoint;
	return typeof configuredEndpoint === 'string' && configuredEndpoint.trim().length > 0
		? configuredEndpoint.trim()
		: DEFAULT_TEMPLATE_CATALOG_URL;
}

export function resolveTreeseedTemplateCatalogCachePath(startRoot = process.cwd()) {
	const machineConfigPath = findNearestTreeseedMachineConfig(startRoot);
	if (machineConfigPath) {
		return resolve(dirname(dirname(machineConfigPath)), 'cache', 'template-catalog.json');
	}

	return resolve(tmpdir(), TEMPLATE_CATALOG_CACHE_RELATIVE_PATH);
}

export function ensureTreeseedGitignoreEntries(tenantRoot) {
	const gitignorePath = resolve(tenantRoot, '.gitignore');
	const requiredEntries = ['.env.local', '.dev.vars', '.treeseed/'];
	const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
	const lines = current.split(/\r?\n/);
	let changed = false;

	for (const entry of requiredEntries) {
		if (!lines.includes(entry)) {
			lines.push(entry);
			changed = true;
		}
	}

	if (changed || !existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
	}

	return gitignorePath;
}

export function resolveTreeseedMachineEnvironmentValues(tenantRoot, scope) {
	const key = loadMachineKey(tenantRoot);
	const config = loadTreeseedMachineConfig(tenantRoot);
	const values = {
		...(config.environments?.[scope]?.values ?? {}),
	};

	for (const [entryId, payload] of Object.entries(config.environments?.[scope]?.secrets ?? {})) {
		values[entryId] = decryptValue(payload, key);
	}

	return values;
}

export function setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, value) {
	const key = loadMachineKey(tenantRoot);
	const config = loadTreeseedMachineConfig(tenantRoot);
	const scoped = config.environments[scope];

	if (entry.sensitivity === 'secret') {
		delete scoped.values[entry.id];
		if (value) {
			scoped.secrets[entry.id] = encryptValue(value, key);
		} else {
			delete scoped.secrets[entry.id];
		}
	} else {
		delete scoped.secrets[entry.id];
		if (value) {
			scoped.values[entry.id] = value;
		} else {
			delete scoped.values[entry.id];
		}
	}

	writeTreeseedMachineConfig(tenantRoot, config);
	return config;
}

export function collectTreeseedEnvironmentContext(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const tenantConfig = loadOptionalTenantManifest(tenantRoot);
	return resolveTreeseedEnvironmentRegistry({
		deployConfig,
		tenantConfig,
	});
}

export function collectTreeseedConfigSeedValues(tenantRoot, scope) {
	return {
		...readEnvFileIfPresent(resolve(tenantRoot, '.env.local')),
		...readEnvFileIfPresent(resolve(tenantRoot, '.dev.vars')),
		...resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
	};
}

export function applyTreeseedEnvironmentToProcess({ tenantRoot, scope }) {
	const resolvedValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	for (const [key, value] of Object.entries(resolvedValues)) {
		if ((process.env[key] ?? '').length === 0 && typeof value === 'string' && value.length > 0) {
			process.env[key] = value;
		}
	}
	return resolvedValues;
}

export function validateTreeseedCommandEnvironment({ tenantRoot, scope, purpose }) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const machineValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const values = {
		...machineValues,
		...Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value ?? undefined])),
	};
	const validation = validateTreeseedEnvironmentValues({
		values,
		scope,
		purpose,
		deployConfig: registry.context.deployConfig,
		tenantConfig: registry.context.tenantConfig,
		plugins: registry.context.plugins,
	});
	return {
		registry,
		values,
		validation,
	};
}

export function assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose }) {
	const report = validateTreeseedCommandEnvironment({ tenantRoot, scope, purpose });
	if (report.validation.ok) {
		return report;
	}

	const lines = [
		`Treeseed environment is not ready for ${purpose} (${scope}).`,
		'Run `treeseed config` to fill in the missing values, or export them in the current shell.',
	];

	for (const problem of [...report.validation.missing, ...report.validation.invalid]) {
		lines.push(`- ${problem.message}`);
	}

	const error = new Error(lines.join('\n'));
	error.kind = report.validation.missing.length > 0 ? 'missing_config' : 'invalid_config';
	error.details = report.validation;
	throw error;
}

function renderEnvEntries(entries, values) {
	return entries
		.map((entry) => [entry.id, values[entry.id]])
		.filter(([, value]) => typeof value === 'string' && value.length > 0)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');
}

export function writeTreeseedLocalEnvironmentFiles(tenantRoot) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const scope = 'local';
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);

	const envEntries = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('local-file'),
	);
	const devVarsEntries = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('wrangler-dev-vars'),
	);

	writeFileSync(resolve(tenantRoot, '.env.local'), `${renderEnvEntries(envEntries, values)}\n`, 'utf8');
	writeFileSync(resolve(tenantRoot, '.dev.vars'), `${renderEnvEntries(devVarsEntries, values)}\n`, 'utf8');

	return {
		envLocalPath: resolve(tenantRoot, '.env.local'),
		devVarsPath: resolve(tenantRoot, '.dev.vars'),
	};
}

function runGh(args, { cwd, dryRun = false, input } = {}) {
	if (dryRun) {
		return { status: 0, stdout: '', stderr: '' };
	}
	const result = spawnSync('gh', args, {
		cwd,
		stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		input,
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `gh ${args.join(' ')} failed`);
	}
	return result;
}

function listGitHubNames(command, repository, tenantRoot) {
	const result = runGh([command, 'list', '--repo', repository, '--json', 'name'], { cwd: tenantRoot });
	return new Set((JSON.parse(result.stdout || '[]')).map((entry) => entry?.name).filter(Boolean));
}

export function syncTreeseedGitHubEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const repository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		throw new Error('Unable to determine the GitHub repository from the origin remote.');
	}

	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const relevant = registry.entries.filter((entry) => entry.scopes.includes(scope));
	const secretNames = listGitHubNames('secret', repository, tenantRoot);
	const variableNames = listGitHubNames('variable', repository, tenantRoot);
	const synced = {
		secrets: [],
		variables: [],
	};

	for (const entry of relevant) {
		const value = values[entry.id];
		if (!value) {
			continue;
		}

		if (entry.targets.includes('github-secret')) {
			runGh(['secret', 'set', entry.id, '--repo', repository, '--body', value], { cwd: tenantRoot, dryRun });
			synced.secrets.push({ name: entry.id, existed: secretNames.has(entry.id) });
		}

		if (entry.targets.includes('github-variable')) {
			runGh(['variable', 'set', entry.id, '--repo', repository, '--body', value], { cwd: tenantRoot, dryRun });
			synced.variables.push({ name: entry.id, existed: variableNames.has(entry.id) });
		}
	}

	return {
		repository,
		scope,
		...synced,
	};
}

export function syncTreeseedCloudflareEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const target = createPersistentDeployTarget(scope);
	for (const [key, value] of Object.entries(values)) {
		if (typeof value === 'string' && value.length > 0) {
			process.env[key] = value;
		}
	}

	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	const syncedSecrets = syncCloudflareSecrets(tenantRoot, { dryRun, target });
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const cloudflareVars = registry.entries
		.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('cloudflare-var'))
		.map((entry) => entry.id)
		.filter((key) => typeof values[key] === 'string' && values[key].length > 0);

	return {
		scope,
		target,
		wranglerPath,
		secrets: syncedSecrets,
		varsManagedByWranglerConfig: cloudflareVars,
	};
}

export function initializeTreeseedPersistentEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const normalizedScope = scope === 'prod' ? 'prod' : scope;
	const target = createPersistentDeployTarget(normalizedScope);
	const summary = provisionCloudflareResources(tenantRoot, { dryRun, target });
	ensureGeneratedWranglerConfig(tenantRoot, { target });
	const syncedSecrets = syncCloudflareSecrets(tenantRoot, { dryRun, target });
	if (!dryRun) {
		markDeploymentInitialized(tenantRoot, { target });
	}

	return {
		scope: normalizedScope,
		target,
		summary,
		secrets: syncedSecrets,
	};
}

export async function runTreeseedConfigWizard({
	tenantRoot,
	scopes = ['local', 'staging', 'prod'],
	sync = 'none',
	prompt,
	authStatus,
	write = console.log,
}) {
	ensureTreeseedGitignoreEntries(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const groups = ['local-development', 'forms', 'smtp', 'cloudflare'];
	const summary = {
		scopes,
		updated: [],
		synced: {},
		initialized: [],
	};

	for (const scope of scopes) {
		const existingValues = collectTreeseedConfigSeedValues(tenantRoot, scope);
		const suggested = getTreeseedEnvironmentSuggestedValues({
			scope,
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});

		write(`\nTreeseed configuration for ${scope}`);
		write(`Tenant: ${registry.context.deployConfig.name} (${registry.context.deployConfig.slug})`);
		if (authStatus) {
			write(`GitHub auth: ${authStatus.gh?.authenticated ? 'ready' : 'not ready'}`);
			write(`Wrangler auth: ${authStatus.wrangler?.authenticated ? 'ready' : 'not ready'}`);
		}

		for (const group of groups) {
			const groupEntries = registry.entries.filter(
				(entry) =>
					entry.group === group
					&& entry.scopes.includes(scope)
					&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, 'config')),
			);
			if (groupEntries.length === 0) {
				continue;
			}

			write(`\n[${group}]`);
			for (const entry of groupEntries) {
				const currentValue = existingValues[entry.id];
				const suggestedValue = suggested[entry.id];
				const displayValue = currentValue ?? suggestedValue ?? '';
				write(`\n${entry.label} (${entry.id})`);
				write(`Why: ${entry.description}`);
				write(`How to get it: ${entry.howToGet}`);
				write(`Used for: ${entry.purposes.join(', ')}`);
				write(`Targets: ${entry.targets.join(', ')}`);
				write(`Current: ${entry.sensitivity === 'secret' ? maskValue(currentValue) : currentValue ?? '(unset)'}`);

				const answer = (await prompt(
					`${entry.id}${displayValue ? ` [${entry.sensitivity === 'secret' ? 'keep current' : displayValue}]` : ''}: `,
				)).trim();

				if (answer === '' && displayValue) {
					setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, displayValue);
					summary.updated.push({ scope, id: entry.id, reused: true });
					continue;
				}

				if (answer === '' && !displayValue) {
					setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, '');
					continue;
				}

				if (answer === '-') {
					setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, '');
					summary.updated.push({ scope, id: entry.id, cleared: true });
					continue;
				}

				setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, answer);
				summary.updated.push({ scope, id: entry.id, reused: false });
			}
		}

		const validation = validateTreeseedEnvironmentValues({
			values: resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});
		if (!validation.ok) {
			const details = [...validation.missing, ...validation.invalid]
				.map((problem) => `- ${problem.message}`)
				join('\n');
			throw new Error(`Treeseed config validation failed for ${scope}:\n${details}`);
		}
	}

	writeTreeseedLocalEnvironmentFiles(tenantRoot);

	for (const scope of scopes) {
		if (scope === 'local') {
			continue;
		}

		const initialized = initializeTreeseedPersistentEnvironment({ tenantRoot, scope });
		if (write) {
			writeDeploySummary(write, initialized.summary);
		}
		summary.initialized.push({
			scope,
			secrets: initialized.secrets.length,
			target: initialized.summary.target,
		});
	}

	if (sync === 'github' || sync === 'all') {
		summary.synced.github = syncTreeseedGitHubEnvironment({ tenantRoot, scope: scopes.at(-1) ?? 'prod' });
	}
	if (sync === 'cloudflare' || sync === 'all') {
		summary.synced.cloudflare = syncTreeseedCloudflareEnvironment({ tenantRoot, scope: scopes.at(-1) ?? 'prod' });
	}

	return summary;
}
