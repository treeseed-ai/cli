import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { deriveCloudflareWorkerName } from '@treeseed/core/deploy/config';
import { loadCliDeployConfig, resolveWranglerBin } from './package-tools.ts';

const DEFAULT_COMPATIBILITY_DATE = '2026-04-05';
const DEFAULT_COMPATIBILITY_FLAGS = ['nodejs_compat'];
const GENERATED_ROOT = '.treeseed/generated';
const STATE_ROOT = '.treeseed/state';
const PERSISTENT_SCOPES = new Set(['local', 'staging', 'prod']);
const TRESEED_ENVELOPE_SCHEMA_GENERATION = 'runtime-envelopes-v1';
const TRESEED_MIGRATION_WAVE_ID = '0005_runtime_envelopes';
const TRESEED_SUPPORTED_PAYLOAD_RANGE = { min: 1, max: 1 };

function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function stableHash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function readJson(filePath, fallback) {
	if (!existsSync(filePath)) {
		return fallback;
	}

	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

function writeJson(filePath, value) {
	ensureParent(filePath);
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderTomlString(value) {
	return JSON.stringify(String(value));
}

function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length ? value : null;
}

function loadTenantDeployConfig(tenantRoot) {
	return loadCliDeployConfig(tenantRoot);
}

function sanitizeSegment(value) {
	return String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 36) || 'default';
}

export function normalizePersistentScope(scope = 'prod') {
	if (!PERSISTENT_SCOPES.has(scope)) {
		throw new Error(`Unsupported Treeseed environment "${scope}". Expected one of local, staging, prod.`);
	}
	return scope;
}

export function createPersistentDeployTarget(scope = 'prod') {
	return {
		kind: 'persistent',
		scope: normalizePersistentScope(scope),
	};
}

export function createBranchPreviewDeployTarget(branchName) {
	const normalized = String(branchName ?? '').trim();
	if (!normalized) {
		throw new Error('Branch preview target requires a branch name.');
	}

	return {
		kind: 'branch',
		branchName: normalized,
	};
}

function normalizeTarget(scopeOrTarget = 'prod') {
	if (!scopeOrTarget || typeof scopeOrTarget === 'string') {
		return createPersistentDeployTarget(scopeOrTarget ?? 'prod');
	}

	if (scopeOrTarget.kind === 'persistent') {
		return createPersistentDeployTarget(scopeOrTarget.scope);
	}

	if (scopeOrTarget.kind === 'branch') {
		return createBranchPreviewDeployTarget(scopeOrTarget.branchName);
	}

	throw new Error('Unsupported Treeseed deployment target.');
}

export function scopeFromTarget(target) {
	return target.kind === 'persistent'
		? target.scope
		: 'staging';
}

function targetDirectoryParts(target) {
	if (target.kind === 'persistent') {
		return ['environments', target.scope];
	}

	return ['branches', sanitizeSegment(target.branchName)];
}

function targetKey(target) {
	return target.kind === 'persistent'
		? target.scope
		: `branch:${target.branchName}`;
}

function resolveTargetPaths(tenantRoot, scopeOrTarget = 'prod') {
	const target = normalizeTarget(scopeOrTarget);
	const pathParts = targetDirectoryParts(target);
	const generatedRoot = resolve(tenantRoot, GENERATED_ROOT, ...pathParts);
	const statePath = resolve(tenantRoot, STATE_ROOT, ...pathParts, 'deploy.json');

	return {
		target,
		generatedRoot,
		wranglerPath: resolve(generatedRoot, 'wrangler.toml'),
		workerEntryPath: resolve(generatedRoot, 'worker/index.js'),
		statePath,
	};
}

export function deployTargetLabel(scopeOrTarget = 'prod') {
	const target = normalizeTarget(scopeOrTarget);
	return target.kind === 'persistent' ? target.scope : `branch:${target.branchName}`;
}

function targetWorkerName(deployConfig, target) {
	const baseName = deriveCloudflareWorkerName(deployConfig);
	if (target.kind === 'persistent') {
		if (target.scope === 'prod') {
			return baseName;
		}
		return `${baseName}-${target.scope}`;
	}

	return `${baseName}-${sanitizeSegment(target.branchName)}`;
}

function targetWorkersDevUrl(workerName) {
	return `https://${workerName}.workers.dev`;
}

function relativeFromGeneratedRoot(targetPath, generatedRoot) {
	return relative(generatedRoot, targetPath).replaceAll('\\', '/');
}

function buildPublicVars(deployConfig) {
	return {
		TREESEED_AGENT_EXECUTION_PROVIDER: deployConfig.providers?.agents?.execution ?? 'stub',
		TREESEED_AGENT_REPOSITORY_PROVIDER: deployConfig.providers?.agents?.repository ?? 'stub',
		TREESEED_AGENT_VERIFICATION_PROVIDER: deployConfig.providers?.agents?.verification ?? 'stub',
		TREESEED_PUBLIC_TURNSTILE_SITE_KEY: envOrNull('TREESEED_PUBLIC_TURNSTILE_SITE_KEY') ?? '',
	};
}

function buildSecretMap(deployConfig, state) {
	const generatedSecret = state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET ?? randomBytes(24).toString('hex');
	return {
		TREESEED_FORM_TOKEN_SECRET: envOrNull('TREESEED_FORM_TOKEN_SECRET') ?? generatedSecret,
		TREESEED_TURNSTILE_SECRET_KEY: envOrNull('TREESEED_TURNSTILE_SECRET_KEY'),
		TREESEED_SMTP_HOST: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_HOST') : null,
		TREESEED_SMTP_PORT: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_PORT') : null,
		TREESEED_SMTP_USERNAME: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_USERNAME') : null,
		TREESEED_SMTP_PASSWORD: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_PASSWORD') : null,
		TREESEED_SMTP_FROM: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_FROM') : null,
		TREESEED_SMTP_REPLY_TO: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_REPLY_TO') : null,
	};
}

function defaultStateFromConfig(deployConfig, target) {
	const workerName = targetWorkerName(deployConfig, target);
	const suffix = target.kind === 'persistent' ? target.scope : sanitizeSegment(target.branchName);

	return {
		version: 2,
		target,
		previewEnabled: target.kind === 'branch',
		workerName,
		kvNamespaces: {
			FORM_GUARD_KV: {
				name: `${workerName}-form-guard`,
				id: `dryrun-${suffix}-form-guard`,
				previewId: `dryrun-${suffix}-form-guard-preview`,
			},
			SESSION: {
				name: `${workerName}-session`,
				id: `dryrun-${suffix}-session`,
				previewId: `dryrun-${suffix}-session-preview`,
			},
		},
		d1Databases: {
			SITE_DATA_DB: {
				databaseName: `${workerName}-site-data`,
				databaseId: `dryrun-${suffix}-site-data`,
				previewDatabaseId: `dryrun-${suffix}-site-data-preview`,
			},
		},
		generatedSecrets: {},
		readiness: {
			initialized: false,
			initializedAt: null,
			lastValidatedAt: null,
			lastConfigFingerprint: null,
		},
		lastDeployedUrl: target.kind === 'branch' ? targetWorkersDevUrl(workerName) : null,
		lastManifestFingerprint: null,
		lastDeploymentTimestamp: null,
		lastDeployedCommit: null,
		runtimeCompatibility: {
			envelopeSchemaGeneration: TRESEED_ENVELOPE_SCHEMA_GENERATION,
			migrationWaveId: TRESEED_MIGRATION_WAVE_ID,
			supportedPayloadVersionRange: TRESEED_SUPPORTED_PAYLOAD_RANGE,
		},
		deploymentHistory: [],
	};
}

export function loadDeployState(tenantRoot, deployConfig, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const defaults = defaultStateFromConfig(deployConfig, target);
	const { statePath } = resolveTargetPaths(tenantRoot, target);
	const persisted = readJson(statePath, {});
	const persistedSiteDataDb = persisted.d1Databases?.SITE_DATA_DB ?? persisted.d1Databases?.SUBSCRIBERS_DB ?? {};
	const merged = {
		...defaults,
		...persisted,
		target,
		previewEnabled: persisted.previewEnabled ?? defaults.previewEnabled,
		workerName: defaults.workerName,
		kvNamespaces: {
			...defaults.kvNamespaces,
			...(persisted.kvNamespaces ?? {}),
			FORM_GUARD_KV: {
				...defaults.kvNamespaces.FORM_GUARD_KV,
				...(persisted.kvNamespaces?.FORM_GUARD_KV ?? {}),
				name: defaults.kvNamespaces.FORM_GUARD_KV.name,
			},
			SESSION: {
				...defaults.kvNamespaces.SESSION,
				...(persisted.kvNamespaces?.SESSION ?? {}),
				name: defaults.kvNamespaces.SESSION.name,
			},
		},
		d1Databases: {
			...defaults.d1Databases,
			...(persisted.d1Databases ?? {}),
			SITE_DATA_DB: {
				...defaults.d1Databases.SITE_DATA_DB,
				...persistedSiteDataDb,
				databaseName: defaults.d1Databases.SITE_DATA_DB.databaseName,
			},
		},
		generatedSecrets: {
			...(defaults.generatedSecrets ?? {}),
			...(persisted.generatedSecrets ?? {}),
		},
		readiness: {
			...defaults.readiness,
			...(persisted.readiness ?? {}),
		},
	};

	if (target.kind === 'branch' && !merged.lastDeployedUrl) {
		merged.lastDeployedUrl = targetWorkersDevUrl(merged.workerName);
	}

	return merged;
}

export function writeDeployState(tenantRoot, state, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? state.target ?? 'prod');
	const { statePath } = resolveTargetPaths(tenantRoot, target);
	writeJson(statePath, {
		...state,
		target,
	});
}

export function resolveGeneratedWranglerPath(tenantRoot, options = {}) {
	return resolveTargetPaths(tenantRoot, options.scope ?? options.target ?? 'prod').wranglerPath;
}

export function buildWranglerConfigContents(tenantRoot, deployConfig, state, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? state.target ?? 'prod');
	const { generatedRoot } = resolveTargetPaths(tenantRoot, target);
	const workerName = state.workerName ?? targetWorkerName(deployConfig, target);
	const mainPath = relativeFromGeneratedRoot(resolve(generatedRoot, 'worker/index.js'), generatedRoot);
	const assetsDirectory = relativeFromGeneratedRoot(resolve(tenantRoot, 'dist'), generatedRoot);
	const migrationsDir = relativeFromGeneratedRoot(resolve(tenantRoot, 'migrations'), generatedRoot);
	const vars = buildPublicVars(deployConfig);

	return [
		`name = ${renderTomlString(workerName)}`,
		`compatibility_date = ${renderTomlString(DEFAULT_COMPATIBILITY_DATE)}`,
		`compatibility_flags = [${DEFAULT_COMPATIBILITY_FLAGS.map((flag) => renderTomlString(flag)).join(', ')}]`,
		`main = ${renderTomlString(mainPath)}`,
		'workers_dev = true',
		'preview_urls = true',
		'',
		'[assets]',
		`directory = ${renderTomlString(assetsDirectory)}`,
		'',
		'[vars]',
		...Object.entries(vars).map(([key, value]) => `${key} = ${renderTomlString(value)}`),
		'',
		'[[kv_namespaces]]',
		'binding = "FORM_GUARD_KV"',
		`id = ${renderTomlString(state.kvNamespaces.FORM_GUARD_KV.id)}`,
		`preview_id = ${renderTomlString(state.kvNamespaces.FORM_GUARD_KV.previewId ?? state.kvNamespaces.FORM_GUARD_KV.id)}`,
		'',
		'[[kv_namespaces]]',
		'binding = "SESSION"',
		`id = ${renderTomlString(state.kvNamespaces.SESSION.id)}`,
		`preview_id = ${renderTomlString(state.kvNamespaces.SESSION.previewId ?? state.kvNamespaces.SESSION.id)}`,
		'',
		'[[d1_databases]]',
		'binding = "SITE_DATA_DB"',
		`database_name = ${renderTomlString(state.d1Databases.SITE_DATA_DB.databaseName)}`,
		`database_id = ${renderTomlString(state.d1Databases.SITE_DATA_DB.databaseId)}`,
		`preview_database_id = ${renderTomlString(state.d1Databases.SITE_DATA_DB.previewDatabaseId ?? state.d1Databases.SITE_DATA_DB.databaseId)}`,
		`migrations_dir = ${renderTomlString(migrationsDir)}`,
		'',
	].join('\n');
}

export function ensureGeneratedWranglerConfig(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const { wranglerPath } = resolveTargetPaths(tenantRoot, target);
	const manifestFingerprint = stableHash(JSON.stringify({ deployConfig, targetKey: targetKey(target) }));
	const contents = buildWranglerConfigContents(tenantRoot, deployConfig, state, { target });
	ensureParent(wranglerPath);
	writeFileSync(wranglerPath, contents, 'utf8');
	state.lastManifestFingerprint = manifestFingerprint;
	state.readiness.lastConfigFingerprint = manifestFingerprint;
	if (!state.generatedSecrets) {
		state.generatedSecrets = {};
	}
	const secretMap = buildSecretMap(deployConfig, state);
	state.generatedSecrets.TREESEED_FORM_TOKEN_SECRET = secretMap.TREESEED_FORM_TOKEN_SECRET;
	writeDeployState(tenantRoot, state, { target });
	return { wranglerPath, deployConfig, state, manifestFingerprint, target };
}

function runWrangler(args, { cwd, allowFailure = false, json = false, capture = false, env = {}, input } = {}) {
	const result = spawnSync(process.execPath, [resolveWranglerBin(), ...args], {
		stdio: json || capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
		cwd,
		env: { ...process.env, ...env },
		encoding: 'utf8',
		input,
	});

	if (result.status !== 0 && !allowFailure) {
		const stderr = result.stderr?.trim();
		throw new Error(stderr || `Wrangler command failed: ${args.join(' ')}`);
	}

	return result;
}

function parseWranglerJsonOutput(result, label) {
	const source = `${result.stdout ?? ''}`.trim();
	if (!source) {
		throw new Error(`Expected JSON output from ${label}.`);
	}
	return JSON.parse(source);
}

function listKvNamespaces(tenantRoot, env) {
	const result = runWrangler(['kv', 'namespace', 'list'], {
		cwd: tenantRoot,
		capture: true,
		env,
	});
	return parseWranglerJsonOutput(result, 'KV namespace list');
}

function listD1Databases(tenantRoot, env) {
	const result = runWrangler(['d1', 'list', '--json'], {
		cwd: tenantRoot,
		capture: true,
		env,
	});
	return parseWranglerJsonOutput(result, 'D1 list');
}

function isPlaceholderResourceId(value) {
	if (!value || typeof value !== 'string') {
		return true;
	}

	return (
		value.startsWith('local-')
		|| value.startsWith('dryrun-')
		|| value.endsWith('-id')
		|| value.endsWith('-preview-id')
	);
}

function buildProvisioningSummary(deployConfig, state, target) {
	return {
		target: deployTargetLabel(target),
		workerName: state.workerName ?? targetWorkerName(deployConfig, target),
		siteUrl: target.kind === 'branch' ? targetWorkersDevUrl(state.workerName) : deployConfig.siteUrl,
		accountId: deployConfig.cloudflare.accountId,
		formGuardKv: state.kvNamespaces.FORM_GUARD_KV,
		sessionKv: state.kvNamespaces.SESSION,
		siteDataDb: state.d1Databases.SITE_DATA_DB,
	};
}

function buildDestroySummary(deployConfig, state, target) {
	return buildProvisioningSummary(deployConfig, state, target);
}

function isPlaceholderAccountId(value) {
	return !value || value === 'replace-with-cloudflare-account-id';
}

function missingTurnstileRequirements() {
	const issues = [];
	if (!envOrNull('TREESEED_PUBLIC_TURNSTILE_SITE_KEY')) {
		issues.push('Set TREESEED_PUBLIC_TURNSTILE_SITE_KEY before deploying.');
	}
	if (!envOrNull('TREESEED_TURNSTILE_SECRET_KEY')) {
		issues.push('Set TREESEED_TURNSTILE_SECRET_KEY before deploying.');
	}
	return issues;
}

export function collectMissingDeployInputs(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const missing = [];

	if (isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		missing.push({
			key: 'CLOUDFLARE_ACCOUNT_ID',
			label: 'Cloudflare account ID',
			message: `Cloudflare account ID is missing. Add it to ${relative(tenantRoot, deployConfig.__configPath ?? resolve(tenantRoot, 'treeseed.site.yaml'))} or provide it now.`,
		});
	}

	if (!envOrNull('TREESEED_PUBLIC_TURNSTILE_SITE_KEY')) {
		missing.push({
			key: 'TREESEED_PUBLIC_TURNSTILE_SITE_KEY',
			label: 'Turnstile public site key',
			message: 'Turnstile public site key is missing for deploy.',
		});
	}

	if (!envOrNull('TREESEED_TURNSTILE_SECRET_KEY')) {
		missing.push({
			key: 'TREESEED_TURNSTILE_SECRET_KEY',
			label: 'Turnstile secret key',
			message: 'Turnstile secret key is missing for deploy.',
		});
	}

	return missing;
}

export async function promptForMissingDeployInputs(tenantRoot) {
	const missing = collectMissingDeployInputs(tenantRoot);
	if (!missing.length || !process.stdin.isTTY || !process.stdout.isTTY) {
		return { prompted: false, provided: [] };
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const provided = [];

	try {
		console.log('Treeseed deploy needs a few missing values before it can continue.');
		console.log('These values will be used for this deploy process only. Persist them in your env files or CI secrets afterward.');

		for (const item of missing) {
			console.log(`- ${item.message}`);
			const answer = (await rl.question(`${item.label}: `)).trim();
			if (!answer) {
				continue;
			}
			process.env[item.key] = answer;
			provided.push(item.key);
		}
	} finally {
		rl.close();
	}

	return { prompted: true, provided };
}

export function validateDeployPrerequisites(tenantRoot, { requireRemote = true } = {}) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const issues = [];

	if (isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		issues.push(
			`Set cloudflare.accountId in ${relative(tenantRoot, deployConfig.__configPath ?? resolve(tenantRoot, 'treeseed.site.yaml'))} or export CLOUDFLARE_ACCOUNT_ID.`,
		);
	}

	if (requireRemote) {
		issues.push(...missingTurnstileRequirements());

		const result = runWrangler(['whoami'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
		});
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/You are not authenticated/i.test(output) || /wrangler login/i.test(output)) {
			issues.push('Authenticate Wrangler first with `wrangler login`.');
		}
	}

	if (issues.length > 0) {
		throw new Error(`Treeseed deploy prerequisites are not satisfied:\n- ${issues.join('\n- ')}`);
	}

	return deployConfig;
}

export function validateDestroyPrerequisites(tenantRoot, { requireRemote = true } = {}) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const issues = [];

	if (requireRemote && isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		issues.push(
			`Set cloudflare.accountId in ${relative(tenantRoot, deployConfig.__configPath ?? resolve(tenantRoot, 'treeseed.site.yaml'))} or export CLOUDFLARE_ACCOUNT_ID.`,
		);
	}

	if (requireRemote) {
		const result = runWrangler(['whoami'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
		});
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/You are not authenticated/i.test(output) || /wrangler login/i.test(output)) {
			issues.push('Authenticate Wrangler first with `wrangler login`.');
		}
	}

	if (issues.length > 0) {
		throw new Error(`Treeseed destroy prerequisites are not satisfied:\n- ${issues.join('\n- ')}`);
	}

	return deployConfig;
}

function resolveExistingKvIdByName(kvNamespaces, expectedName, fallbackId) {
	if (fallbackId && !isPlaceholderResourceId(fallbackId)) {
		return fallbackId;
	}

	return kvNamespaces.find((entry) => entry?.title === expectedName)?.id ?? null;
}

function resolveExistingD1ByName(d1Databases, expectedName, current) {
	if (current?.databaseId && !isPlaceholderResourceId(current.databaseId)) {
		return current;
	}

	const existing = d1Databases.find((entry) => entry?.name === expectedName);
	if (!existing?.uuid) {
		return current;
	}

	return {
		...current,
		databaseId: existing.uuid,
		previewDatabaseId: existing.previewDatabaseUuid ?? existing.uuid,
	};
}

function looksLikeMissingResource(output) {
	return /not found|does not exist|could not find|unknown/i.test(output);
}

function deleteKvNamespace(tenantRoot, namespaceId, { env, dryRun, preview = false }) {
	if (!namespaceId || isPlaceholderResourceId(namespaceId)) {
		return { status: 'missing', id: namespaceId };
	}

	if (dryRun) {
		return { status: 'planned', id: namespaceId, preview };
	}

	const args = ['kv', 'namespace', 'delete', '--namespace-id', namespaceId, '--skip-confirmation'];
	if (preview) {
		args.push('--preview');
	}
	const result = runWrangler(args, {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	if (result.status !== 0 && !looksLikeMissingResource(output)) {
		throw new Error(output.trim() || `Failed to delete KV namespace ${namespaceId}.`);
	}

	return { status: result.status === 0 ? 'deleted' : 'missing', id: namespaceId, preview };
}

function deleteD1Database(tenantRoot, databaseName, { env, dryRun }) {
	if (!databaseName) {
		return { status: 'missing', name: databaseName };
	}

	if (dryRun) {
		return { status: 'planned', name: databaseName };
	}

	const result = runWrangler(['d1', 'delete', databaseName, '--skip-confirmation'], {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	if (result.status !== 0 && !looksLikeMissingResource(output)) {
		throw new Error(output.trim() || `Failed to delete D1 database ${databaseName}.`);
	}

	return { status: result.status === 0 ? 'deleted' : 'missing', name: databaseName };
}

function deleteWorker(tenantRoot, workerName, { env, dryRun, force = false }) {
	if (!workerName) {
		return { status: 'missing', name: workerName };
	}

	if (dryRun) {
		return { status: 'planned', name: workerName };
	}

	const args = ['delete', workerName];
	if (force) {
		args.push('--force');
	}

	const result = runWrangler(args, {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
		input: 'y\n',
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	if (result.status !== 0 && !looksLikeMissingResource(output)) {
		throw new Error(output.trim() || `Failed to delete Worker ${workerName}.`);
	}

	return { status: result.status === 0 ? 'deleted' : 'missing', name: workerName };
}

export function destroyCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);

	const env = {
		CLOUDFLARE_ACCOUNT_ID: deployConfig.cloudflare.accountId,
	};

	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);

	state.kvNamespaces.FORM_GUARD_KV.id = resolveExistingKvIdByName(
		kvNamespaces,
		state.kvNamespaces.FORM_GUARD_KV.name,
		state.kvNamespaces.FORM_GUARD_KV.id,
	);
	state.kvNamespaces.SESSION.id = resolveExistingKvIdByName(
		kvNamespaces,
		state.kvNamespaces.SESSION.name,
		state.kvNamespaces.SESSION.id,
	);
	state.d1Databases.SITE_DATA_DB = resolveExistingD1ByName(
		d1Databases,
		state.d1Databases.SITE_DATA_DB.databaseName,
		state.d1Databases.SITE_DATA_DB,
	);

	const worker = deleteWorker(tenantRoot, state.workerName, { env, dryRun, force });
	const formGuard = deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.id, { env, dryRun });
	const formGuardPreview =
		state.kvNamespaces.FORM_GUARD_KV.previewId
		&& state.kvNamespaces.FORM_GUARD_KV.previewId !== state.kvNamespaces.FORM_GUARD_KV.id
			? deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.previewId, { env, dryRun, preview: true })
			: null;
	const session = deleteKvNamespace(tenantRoot, state.kvNamespaces.SESSION.id, { env, dryRun });
	const sessionPreview =
		state.kvNamespaces.SESSION.previewId
		&& state.kvNamespaces.SESSION.previewId !== state.kvNamespaces.SESSION.id
			? deleteKvNamespace(tenantRoot, state.kvNamespaces.SESSION.previewId, { env, dryRun, preview: true })
			: null;
	const database = deleteD1Database(tenantRoot, state.d1Databases.SITE_DATA_DB.databaseName, { env, dryRun });

	return {
		target,
		summary: buildDestroySummary(deployConfig, state, target),
		operations: {
			worker,
			formGuard,
			formGuardPreview,
			session,
			sessionPreview,
			database,
		},
	};
}

export function cleanupDestroyedState(tenantRoot, options = {}) {
	const target = options.scope || options.target ? normalizeTarget(options.scope ?? options.target) : null;
	if (target) {
		const { statePath, generatedRoot } = resolveTargetPaths(tenantRoot, target);
		rmSync(statePath, { force: true });
		rmSync(generatedRoot, { recursive: true, force: true });
		return;
	}

	rmSync(resolve(tenantRoot, STATE_ROOT), { recursive: true, force: true });
	rmSync(resolve(tenantRoot, GENERATED_ROOT), { recursive: true, force: true });
	if (options.removeBuildArtifacts) {
		rmSync(resolve(tenantRoot, 'dist'), { recursive: true, force: true });
	}
}

export function provisionCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);

	const env = {
		CLOUDFLARE_ACCOUNT_ID: deployConfig.cloudflare.accountId,
	};
	const dryRun = options.dryRun ?? false;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);

	const ensureKv = (binding) => {
		const current = state.kvNamespaces[binding];
		if (current?.id && !isPlaceholderResourceId(current.id)) {
			state.kvNamespaces[binding].previewId = current.previewId ?? current.id;
			return;
		}

		const existing = kvNamespaces.find((entry) => entry?.title === current.name);
		if (existing?.id) {
			state.kvNamespaces[binding].id = existing.id;
			state.kvNamespaces[binding].previewId = existing.id;
			return;
		}

		if (dryRun) {
			state.kvNamespaces[binding].id = `dryrun-${current.name}`;
			state.kvNamespaces[binding].previewId = `dryrun-${current.name}-preview`;
			return;
		}

		runWrangler(['kv', 'namespace', 'create', current.name], { cwd: tenantRoot, capture: true, env });
		const refreshed = listKvNamespaces(tenantRoot, env);
		const created = refreshed.find((entry) => entry?.title === current.name);
		if (!created?.id) {
			throw new Error(`Unable to resolve created KV namespace id for ${current.name}.`);
		}
		state.kvNamespaces[binding].id = created.id;
		state.kvNamespaces[binding].previewId = created.id;
	};

	const ensureD1 = () => {
		const current = state.d1Databases.SITE_DATA_DB;
		if (current?.databaseId && !isPlaceholderResourceId(current.databaseId)) {
			return;
		}

		const existing = d1Databases.find((entry) => entry?.name === current.databaseName);
		if (existing?.uuid) {
			current.databaseId = existing.uuid;
			current.previewDatabaseId = existing.previewDatabaseUuid ?? existing.uuid;
			return;
		}

		if (dryRun) {
			current.databaseId = `dryrun-${current.databaseName}`;
			current.previewDatabaseId = `dryrun-${current.databaseName}-preview`;
			return;
		}

		runWrangler(['d1', 'create', current.databaseName], {
			cwd: tenantRoot,
			capture: true,
			env,
		});
		const refreshed = listD1Databases(tenantRoot, env);
		const created = refreshed.find((entry) => entry?.name === current.databaseName);
		if (!created?.uuid) {
			throw new Error(`Unable to resolve created D1 database id for ${current.databaseName}.`);
		}
		current.databaseId = created.uuid;
		current.previewDatabaseId = created.previewDatabaseUuid ?? created.uuid;
	};

	ensureKv('FORM_GUARD_KV');
	ensureKv('SESSION');
	ensureD1();

	state.readiness.initialized = true;
	state.readiness.initializedAt = new Date().toISOString();
	state.readiness.lastValidatedAt = state.readiness.initializedAt;
	writeDeployState(tenantRoot, state, { target });
	return buildProvisioningSummary(deployConfig, state, target);
}

export function syncCloudflareSecrets(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const env = {
		CLOUDFLARE_ACCOUNT_ID: deployConfig.cloudflare.accountId,
	};
	const secrets = buildSecretMap(deployConfig, state);
	const synced = [];
	const dryRun = options.dryRun ?? false;

	for (const [key, value] of Object.entries(secrets)) {
		if (!value) {
			continue;
		}

		synced.push(key);
		if (dryRun) {
			continue;
		}

		const result = spawnSync(process.execPath, [resolveWranglerBin(), 'secret', 'put', key, '--config', resolveGeneratedWranglerPath(tenantRoot, { target })], {
			cwd: tenantRoot,
			input: `${value}\n`,
			stdio: ['pipe', 'inherit', 'inherit'],
			env: { ...process.env, ...env },
			encoding: 'utf8',
		});

		if (result.status !== 0) {
			throw new Error(`Failed to sync secret ${key}.`);
		}
	}

	state.generatedSecrets = {
		...(state.generatedSecrets ?? {}),
		TREESEED_FORM_TOKEN_SECRET: secrets.TREESEED_FORM_TOKEN_SECRET ?? state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET,
	};
	writeDeployState(tenantRoot, state, { target });
	return synced;
}

export function runRemoteD1Migrations(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const { wranglerPath, deployConfig, state } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	if (options.dryRun) {
		return { databaseName: state.d1Databases.SITE_DATA_DB.databaseName, dryRun: true };
	}

	runWrangler(
		['d1', 'migrations', 'apply', state.d1Databases.SITE_DATA_DB.databaseName, '--remote', '--config', wranglerPath],
		{
			cwd: tenantRoot,
			env: { CLOUDFLARE_ACCOUNT_ID: deployConfig.cloudflare.accountId },
		},
	);

	return { databaseName: state.d1Databases.SITE_DATA_DB.databaseName, dryRun: false };
}

export function markDeploymentInitialized(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const timestamp = new Date().toISOString();
	state.readiness.initialized = true;
	state.readiness.initializedAt = state.readiness.initializedAt ?? timestamp;
	state.readiness.lastValidatedAt = timestamp;
	state.readiness.lastConfigFingerprint = state.lastManifestFingerprint ?? state.readiness.lastConfigFingerprint;
	writeDeployState(tenantRoot, state, { target });
	return state;
}

export function assertDeploymentInitialized(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	if (state.readiness?.initialized) {
		return state;
	}

	throw new Error(
		`Treeseed environment ${deployTargetLabel(target)} has not been initialized. Run \`treeseed config --environment ${scopeFromTarget(target)}\` first.`,
	);
}

export function finalizeDeploymentState(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.lastManifestFingerprint = stableHash(JSON.stringify({ deployConfig, targetKey: targetKey(target) }));
	state.lastDeployedUrl = target.kind === 'branch' ? targetWorkersDevUrl(state.workerName) : deployConfig.siteUrl;
	state.lastDeploymentTimestamp = new Date().toISOString();
	state.lastDeployedCommit = envOrNull('GITHUB_SHA') ?? envOrNull('TREESEED_DEPLOY_COMMIT') ?? null;
	state.runtimeCompatibility = {
		envelopeSchemaGeneration: TRESEED_ENVELOPE_SCHEMA_GENERATION,
		migrationWaveId: TRESEED_MIGRATION_WAVE_ID,
		supportedPayloadVersionRange: TRESEED_SUPPORTED_PAYLOAD_RANGE,
	};
	const nextHistoryEntry = {
		commit: state.lastDeployedCommit,
		timestamp: state.lastDeploymentTimestamp,
		url: state.lastDeployedUrl,
		target: deployTargetLabel(target),
		appVersion: envOrNull('npm_package_version') ?? envOrNull('TREESEED_APP_VERSION') ?? null,
		envelopeSchemaGeneration: TRESEED_ENVELOPE_SCHEMA_GENERATION,
		migrationWaveId: TRESEED_MIGRATION_WAVE_ID,
		supportedPayloadVersionRange: TRESEED_SUPPORTED_PAYLOAD_RANGE,
	};
	const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory : [];
	state.deploymentHistory = [...history, nextHistoryEntry].slice(-20);
	state.readiness.initialized = true;
	state.readiness.lastValidatedAt = state.lastDeploymentTimestamp;
	writeDeployState(tenantRoot, state, { target });
	return state;
}

export function printDeploySummary(summary) {
	console.log('Treeseed deployment summary');
	console.log(`  Target: ${summary.target}`);
	console.log(`  Worker: ${summary.workerName}`);
	console.log(`  Site URL: ${summary.siteUrl}`);
	console.log(`  Account ID: ${summary.accountId}`);
	console.log(`  D1: ${summary.siteDataDb.databaseName} (${summary.siteDataDb.databaseId})`);
	console.log(`  KV FORM_GUARD_KV: ${summary.formGuardKv.id}`);
	console.log(`  KV SESSION: ${summary.sessionKv.id}`);
}

export function printDestroySummary(result) {
	const { summary, operations } = result;
	console.log('Treeseed destroy summary');
	console.log(`  Target: ${summary.target}`);
	console.log(`  Worker: ${summary.workerName} -> ${operations.worker.status}`);
	console.log(`  Site URL: ${summary.siteUrl}`);
	console.log(`  Account ID: ${summary.accountId}`);
	console.log(`  D1: ${summary.siteDataDb.databaseName} -> ${operations.database.status}`);
	console.log(`  KV FORM_GUARD_KV: ${summary.formGuardKv.name} -> ${operations.formGuard.status}`);
	if (operations.formGuardPreview) {
		console.log(`  KV FORM_GUARD_KV preview -> ${operations.formGuardPreview.status}`);
	}
	console.log(`  KV SESSION: ${summary.sessionKv.name} -> ${operations.session.status}`);
	if (operations.sessionPreview) {
		console.log(`  KV SESSION preview -> ${operations.sessionPreview.status}`);
	}
}
