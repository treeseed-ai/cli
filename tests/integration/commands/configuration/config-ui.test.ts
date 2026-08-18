import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { listOperationNames } from '@treeseed/sdk/operations';
import {
	MACHINE_KEY_PASSPHRASE_ENV,
	unlockSecretSessionFromEnv,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeTenantWorkspace, makeWorkspaceRoot } from '../../../support/cli-test-fixtures.ts';
import {
	applyConfigInputInsertion,
	assertSuccessWithDiagnostics,
	buildCliConfigPages,
	buildHelpView,
	cliPackageRoot,
	colorizeCliOutput,
	computeConfigViewportLayout,
	filterCliConfigPages,
	findClickableRegion,
	findCommandSpec,
	listCommandNames,
	makeFakeAgentPackageRoot,
	normalizeConfigInputChunk,
	npmInstallTestEnv,
	parseTerminalMouseInput,
	resolveCurrentConfigValue,
	resolveSdkCatalogFixturePath,
	resolveSdkConfigRuntimePath,
	routeWheelDeltaToScrollRegion,
	runCli,
	runCommandLine,
	shouldUseInkHelp,
} from '../../../support/help-harness.ts';

test('config ui startup page model includes only required unresolved entries and de-duplicates shared entries', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'SHARED_TOKEN', label: 'Shared token', group: 'auth', cluster: 'auth:shared', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_WEB_SERVICE_ID', label: 'Web service ID', group: 'auth', cluster: 'auth:web', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: 'web', effectiveValue: 'web' },
				{ id: 'TREESEED_API_WEB_SERVICE_ID', label: 'API trusted web service ID', group: 'auth', cluster: 'auth:web', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: 'web', effectiveValue: 'web' },
				{ id: 'TREESEED_API_BASE_URL', label: 'API URL', group: 'auth', cluster: 'auth:api', onboardingFeature: null, startupProfile: 'advanced', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config', 'deploy'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: 'http://127.0.0.1:3000', suggestedValue: '', effectiveValue: 'http://127.0.0.1:3000' },
				{ id: 'OPTIONAL_DEFAULTED', label: 'Optional defaulted', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: 'mailpit', effectiveValue: 'mailpit' },
				{ id: 'OPTIONAL_MISSING', label: 'Optional missing', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [
				{ id: 'SHARED_TOKEN', label: 'Shared token', group: 'auth', cluster: 'auth:shared', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_API_BASE_URL', label: 'API URL', group: 'auth', cluster: 'auth:api', onboardingFeature: null, startupProfile: 'advanced', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config', 'deploy'], storage: 'scoped', scope: 'staging', sharedScopes: ['staging'], required: true, currentValue: 'https://staging-api.example.com', suggestedValue: '', effectiveValue: 'https://staging-api.example.com' },
			],
			prod: [
				{ id: 'SHARED_TOKEN', label: 'Shared token', group: 'auth', cluster: 'auth:shared', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'prod', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const entryPages = pages.filter((page) => page.kind === 'entry');
	assert.equal(entryPages.filter((page) => page.entry.id === 'SHARED_TOKEN').length, 1);
	assert.equal(entryPages.some((page) => page.entry.id === 'TREESEED_WEB_SERVICE_ID'), false);
	assert.equal(entryPages.some((page) => page.entry.id === 'TREESEED_API_WEB_SERVICE_ID'), false);
	assert.equal(entryPages.filter((page) => page.entry.id === 'TREESEED_API_BASE_URL').length, 0);
	assert.equal(entryPages.some((page) => page.entry.id === 'OPTIONAL_DEFAULTED'), false);
	assert.equal(entryPages.some((page) => page.entry.id === 'OPTIONAL_MISSING'), true);
});

test('config ui startup includes missing required scoped entries across staging and prod', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'prod', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const smtpScopes = pages
		.filter((page) => page.entry.id === 'TREESEED_SMTP_HOST')
		.map((page) => page.scope);
	assert.deepEqual(smtpScopes, ['local']);
});

test('config ui startup includes required advanced hosted entries that still need attention', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: false, currentValue: '', suggestedValue: '127.0.0.1', effectiveValue: '127.0.0.1' },
			],
			staging: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.deepEqual(
		pages.map((page) => `${page.entry.id}:${page.scope}`),
		['TREESEED_SMTP_HOST:local'],
	);
});

test('config ui startup keeps invalid required values in the wizard until they are corrected', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [],
			staging: [
				{ id: 'TREESEED_SMTP_PORT', label: 'SMTP port', group: 'smtp', cluster: 'smtp', startupProfile: 'optional', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', validation: { kind: 'number' }, scope: 'staging', sharedScopes: ['staging'], required: true, currentValue: 'mailpit', suggestedValue: '', effectiveValue: 'mailpit' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.deepEqual(pages.map((page) => page.entry.id), ['TREESEED_SMTP_PORT']);
});

test('config ui helpers tolerate environment-limited config contexts', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['staging'],
		configReadinessByScope: {
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			staging: [
				{ id: 'TREESEED_HOSTED_HUBS_GITHUB_OWNER', label: 'Hosted owner', group: 'github', cluster: 'github:hosted', startupProfile: 'advanced', requirement: 'conditional', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_GITHUB_TOKEN', label: 'GitHub token', group: 'github', cluster: 'github:token', startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: 'gh-token', suggestedValue: '', effectiveValue: 'gh-token' },
			],
		},
	};

	assert.equal(resolveCurrentConfigValue(context, {}, 'TREESEED_GITHUB_TOKEN', 'local'), 'gh-token');
	assert.deepEqual(
		buildCliConfigPages(context, 'local', {}, 'startup').map((page) => page.entry.id),
		['TREESEED_HOSTED_HUBS_GITHUB_OWNER'],
	);
	assert.deepEqual(buildCliConfigPages(context, 'local', {}, 'full'), []);
	assert.equal(buildCliConfigPages(context, 'staging', {}, 'full').length, 2);
});

test('config ui full page model includes optional resolved entries', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'OPTIONAL_DEFAULTED', label: 'Optional defaulted', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: 'mailpit', effectiveValue: 'mailpit' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.equal(pages.some((page) => page.kind === 'entry' && page.entry.id === 'OPTIONAL_DEFAULTED'), true);
});

test('config ui full page model filters to the selected scope only', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'LOCAL_ONLY', label: 'Local only', group: 'auth', cluster: 'auth:local', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [
				{ id: 'STAGING_ONLY', label: 'Staging only', group: 'auth', cluster: 'auth:staging', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'scoped', scope: 'staging', sharedScopes: ['staging'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.equal(pages.some((page) => page.entry.id === 'LOCAL_ONLY'), true);
	assert.equal(pages.some((page) => page.entry.id === 'STAGING_ONLY'), false);
});

test('config ui full page filter matches id, label, group, and cluster', () => {
	const pages = [
		{
			kind: 'entry',
			key: 'local:TREESEED_SMTP_HOST',
			entry: {
				id: 'TREESEED_SMTP_HOST',
				label: 'SMTP host',
				group: 'smtp',
				cluster: 'smtp',
				startupProfile: 'optional',
				requirement: 'conditional',
				description: '',
				howToGet: '',
				sensitivity: 'plain',
				targets: [],
				purposes: ['config'],
				storage: 'scoped',
				scope: 'local',
				sharedScopes: ['local'],
				required: false,
				currentValue: '',
				suggestedValue: '127.0.0.1',
				effectiveValue: '127.0.0.1',
			},
			scope: 'local',
			scopes: ['local'],
			requiredScopes: [],
			required: false,
			currentValue: '',
			suggestedValue: '127.0.0.1',
			finalValue: '127.0.0.1',
			wizardRequiredMissing: false,
		},
		{
			kind: 'entry',
			key: 'local:TREESEED_FORM_TOKEN_SECRET',
			entry: {
				id: 'TREESEED_FORM_TOKEN_SECRET',
				label: 'Forms token secret',
				group: 'forms',
				cluster: 'forms-core',
				startupProfile: 'core',
				requirement: 'required',
				description: '',
				howToGet: '',
				sensitivity: 'secret',
				targets: [],
				purposes: ['config'],
				storage: 'shared',
				scope: 'local',
				sharedScopes: ['local', 'staging', 'prod'],
				required: true,
				currentValue: '',
				suggestedValue: '',
				effectiveValue: '',
			},
			scope: 'local',
			scopes: ['local'],
			requiredScopes: ['local'],
			required: true,
			currentValue: '',
			suggestedValue: '',
			finalValue: '',
			wizardRequiredMissing: true,
		},
	];
	assert.deepEqual(filterCliConfigPages(pages, 'smtp').map((page) => page.entry.id), ['TREESEED_SMTP_HOST']);
	assert.deepEqual(filterCliConfigPages(pages, 'Forms token').map((page) => page.entry.id), ['TREESEED_FORM_TOKEN_SECRET']);
	assert.deepEqual(filterCliConfigPages(pages, 'forms-core').map((page) => page.entry.id), ['TREESEED_FORM_TOKEN_SECRET']);
});

test('config ui startup keeps clustered variables adjacent across scopes and preserves shared-before-scoped ordering', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		onboardingFeatures: [],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [],
			staging: [
				{ id: 'TREESEED_SMTP_HOST', label: 'SMTP host', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_SMTP_PASSWORD', label: 'SMTP password', group: 'smtp', cluster: 'smtp', onboardingFeature: null, startupProfile: 'optional', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'staging', sharedScopes: ['staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	const entryIds = pages
		.filter((page) => page.kind === 'entry')
		.map((page) => `${page.entry.id}:${page.scope}`);
	assert.deepEqual(entryIds, [
		'TREESEED_SMTP_HOST:staging',
		'TREESEED_SMTP_PASSWORD:staging',
	]);
});

test('config ui orders provider workflow groups before cluster names', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_FORM_TOKEN_SECRET', label: 'Forms token', group: 'forms', cluster: 'z-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_CLOUDFLARE_API_TOKEN', label: 'Cloudflare token', group: 'cloudflare', cluster: 'a-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_RAILWAY_API_TOKEN', label: 'Railway token', group: 'railway', cluster: 'm-cluster', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'scoped', scope: 'local', sharedScopes: ['local'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	assert.deepEqual(
		pages.map((page) => page.entry.id),
		['TREESEED_CLOUDFLARE_API_TOKEN', 'TREESEED_RAILWAY_API_TOKEN', 'TREESEED_FORM_TOKEN_SECRET'],
	);
});

test('config ui keeps mixed-group Cloudflare account settings adjacent', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local', 'staging', 'prod'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			staging: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
			prod: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{ id: 'TREESEED_CLOUDFLARE_API_TOKEN', label: 'Cloudflare token', group: 'auth', cluster: 'auth:a', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare account ID', group: 'cloudflare', cluster: 'cloudflare:z', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'plain', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
				{ id: 'TREESEED_RAILWAY_API_TOKEN', label: 'Railway token', group: 'railway', cluster: 'railway:a', onboardingFeature: null, startupProfile: 'core', requirement: 'required', description: '', howToGet: '', sensitivity: 'secret', targets: [], purposes: ['config'], storage: 'shared', scope: 'local', sharedScopes: ['local', 'staging', 'prod'], required: true, currentValue: '', suggestedValue: '', effectiveValue: '' },
			],
			staging: [],
			prod: [],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'full');
	const orderedIds = pages.map((page) => page.entry.id);
	const tokenIndex = orderedIds.indexOf('TREESEED_CLOUDFLARE_API_TOKEN');
	const accountIndex = orderedIds.indexOf('TREESEED_CLOUDFLARE_ACCOUNT_ID');
	assert.equal(Math.abs(tokenIndex - accountIndex), 1);
	assert.equal(orderedIds.at(-1), 'TREESEED_RAILWAY_API_TOKEN');
});

test('config ui keeps short required secret values in the startup wizard', () => {
	const context = {
		project: { name: 'Test', slug: 'test' },
		scopes: ['local'],
		configReadinessByScope: {
			local: { github: { configured: false }, cloudflare: { configured: false }, railway: { configured: false }, localDevelopment: { configured: true } },
		},
		entriesByScope: {
			local: [
				{
					id: 'TREESEED_RAILWAY_API_TOKEN',
					label: 'Railway token',
					group: 'auth',
					cluster: 'auth:railway',
					onboardingFeature: null,
					startupProfile: 'core',
					requirement: 'required',
					description: '',
					howToGet: '',
					sensitivity: 'secret',
					targets: [],
					purposes: ['config'],
					storage: 'shared',
					scope: 'local',
					sharedScopes: ['local', 'staging', 'prod'],
					required: true,
					validation: { kind: 'nonempty', minLength: 8 },
					currentValue: '0',
					suggestedValue: '',
					effectiveValue: '0',
				},
			],
		},
	};
	const pages = buildCliConfigPages(context, 'local', {}, 'startup');
	assert.equal(pages.length, 1);
	assert.equal(pages[0].entry.id, 'TREESEED_RAILWAY_API_TOKEN');
	assert.equal(pages[0].wizardRequiredMissing, true);
});

test('config ui viewport layout stays within the terminal height budget', () => {
	const layout = computeConfigViewportLayout(12, 80);
	assert.ok(layout.totalHeight <= 12);
	assert.ok(layout.bodyHeight > 0);
	assert.ok(layout.detailViewportHeight > 0);
	assert.ok(layout.inputHeight > 0);
});

test('config ui normalizes bracketed paste chunks', () => {
	assert.equal(normalizeConfigInputChunk('\u001b[200~multi\nline\u001b[201~'), 'multi\nline');
});

test('config ui strips trailing newlines from pasted config values', () => {
	assert.equal(normalizeConfigInputChunk('secret-value\n'), 'secret-value');
	assert.equal(normalizeConfigInputChunk('\u001b[200~secret-value\r\n\u001b[201~'), 'secret-value');
});

test('config ui applies pasted text at the cursor position', () => {
	const inserted = applyConfigInputInsertion({ value: 'abcdef', cursor: 3 }, 'XYZ');
	assert.deepEqual(inserted, { value: 'abcXYZdef', cursor: 6 });
});

test('config ui preserves multiline bracketed paste content', () => {
	const inserted = applyConfigInputInsertion({ value: '', cursor: 0 }, '\u001b[200~alpha\nbeta\u001b[201~');
	assert.deepEqual(inserted, { value: 'alpha\nbeta', cursor: 'alpha\nbeta'.length });
});

test('terminal mouse parser recognizes sgr mouse release events', () => {
	const events = parseTerminalMouseInput('\u001b[<0;12;5m');
	assert.equal(events.length, 1);
	assert.equal(events[0].x, 11);
	assert.equal(events[0].y, 4);
	assert.equal(events[0].button, 'left');
	assert.equal(events[0].action, 'release');
});

test('sdk config runtime no longer embeds ink hook usage', () => {
	const runtimeSource = readFileSync(resolveSdkConfigRuntimePath(), 'utf8');
	assert.doesNotMatch(runtimeSource, /useStdoutDimensions/);
	assert.doesNotMatch(runtimeSource, /runTreeseedConfigWizard/);
});

test('config ui no longer renders an in-app wizard or view switcher', () => {
	const configUiSource = [
		'config-ui.ts',
		'config-ui-view.ts',
		'config-ui-interactions.ts',
		'config-ui-layout.ts',
		'config-ui-model.ts',
	].map((file) => readFileSync(resolve(cliPackageRoot, 'src', 'cli', 'handlers', 'configuration', file), 'utf8')).join('\n');
	assert.doesNotMatch(configUiSource, /title:\s*'View'/);
	assert.doesNotMatch(configUiSource, /Startup Wizard/);
	assert.doesNotMatch(configUiSource, /Full Editor/);
	assert.doesNotMatch(configUiSource, /Step \$\{step\.index \+ 1\} of \$\{step\.total\}/);
	assert.match(configUiSource, /Wizard mode across/);
	assert.doesNotMatch(configUiSource, /\(empty\)/);
});

test('text input helper copy no longer uses parenthesized empty placeholders', () => {
	const frameworkSource = readFileSync(resolve(cliPackageRoot, 'src', 'cli', 'ui', 'framework.ts'), 'utf8');
	assert.doesNotMatch(frameworkSource, /\(empty\)/);
	assert.doesNotMatch(frameworkSource, /Value is unset\. Type or paste a value\./);
	assert.match(frameworkSource, /props\.secret && props\.value\.length > 0 \? formatSecretMaskedValue\(props\.value\) : props\.value/);
});
