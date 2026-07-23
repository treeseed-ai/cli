import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
export { makeWorkspaceRoot } from './cli-test-fixtures.ts';
import { makeWorkspaceRoot } from './cli-test-fixtures.ts';
import { setMarketSession } from '@treeseed/sdk/market-client';
import {
	createDefaultTreeseedMachineConfig,
	unlockTreeseedSecretSessionWithPassphrase,
	writeTreeseedMachineConfig,
} from '@treeseed/sdk/workflow-support';

export const { runTreeseedCli } = await import('../../dist/cli/main.js');

export function tempD1Path() {
	return mkdtempSync(resolve(tmpdir(), 'treeseed-seed-d1-'));
}

export async function runCli(args, options = {}) {
	const writes = [];
	const env = {
		...process.env,
		NODE_ENV: 'test',
		TREESEED_KEY_AGENT_TRANSPORT: 'inline',
		CI: undefined,
		ACT: undefined,
		GITHUB_ACTIONS: undefined,
		TREESEED_VERIFY_DRIVER: undefined,
		...(options.env ?? {}),
	};
	const previousEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	let exitCode;
	try {
		exitCode = await runTreeseedCli(args, {
		cwd: options.cwd ?? process.cwd(),
		env,
		interactiveUi: false,
		write(output, stream) {
			writes.push({ output, stream });
		},
		spawn() {
			return { status: 0 };
		},
		});
	} finally {
		for (const [key, value] of previousEnv) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
	return {
		exitCode,
		writes,
		stdout: writes.filter((entry) => entry.stream === 'stdout').map((entry) => entry.output).join('\n'),
		stderr: writes.filter((entry) => entry.stream === 'stderr').map((entry) => entry.output).join('\n'),
		output: writes.map((entry) => entry.output).join('\n'),
	};
}

export function writeSeed(root, name, yaml) {
	mkdirSync(resolve(root, 'seeds'), { recursive: true });
	writeFileSync(resolve(root, 'seeds', `${name}.yaml`), yaml, 'utf8');
}

export function writeLocalSeedService(root) {
	const serviceRoot = resolve(root, 'src', 'lib', 'market', 'seeds');
	mkdirSync(serviceRoot, { recursive: true });
	writeFileSync(resolve(root, 'src', 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
	writeFileSync(resolve(serviceRoot, 'apply.js'), `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function markerPath(input) {
	const root = input.env?.TREESEED_API_D1_LOCAL_PERSIST_TO || resolve(input.projectRoot, '.treeseed-test-state');
	mkdirSync(root, { recursive: true });
	return resolve(root, 'seed-applied.json');
}

export function unchangedPlan(plan) {
	const actions = plan.actions.map((action) => action.action === 'create' || action.action === 'update' ? { ...action, action: 'unchanged' } : action);
	const unchanged = actions.filter((action) => action.action === 'unchanged').length;
	return {
		...plan,
		summary: {
			...plan.summary,
			create: 0,
			update: 0,
			unchanged,
		},
		actions,
	};
}

export async function planLocalSeedFromCli(input) {
	return { plan: null, diagnostics: [], manifestPath: resolve(input.projectRoot, 'seeds', input.seedName + '.yaml') };
}

export async function applyLocalSeedFromCli(input) {
	const marker = markerPath(input);
	const alreadyApplied = existsSync(marker);
	const plan = alreadyApplied ? unchangedPlan(input.plan) : input.plan;
	if (!alreadyApplied) {
		writeFileSync(marker, JSON.stringify({ applied: true }), 'utf8');
	}
	return {
		plan,
		result: {
			appliedAt: '2026-01-01T00:00:00.000Z',
			manifestHash: 'test-manifest-hash',
			actionCount: alreadyApplied ? 0 : input.plan.summary.create + input.plan.summary.update,
		},
	};
}

export async function exportSeedFromCli(input) {
	return {
		ok: true,
		seed: input.seedName,
		manifest: {},
		yaml: [
			'name: ' + input.seedName,
			'version: 1',
			'resources:',
			'  repositoryHosts: []',
			'  products: []',
			'  catalogArtifacts: []',
			'',
		].join('\\n'),
		diagnostics: [],
	};
}
`, 'utf8');
}

export function seedWorkspace({ localService = true } = {}) {
	const root = makeWorkspaceRoot();
	writeSeed(root, 'treeseed', CANONICAL_TREESEED_SEED);
	if (localService) {
		writeLocalSeedService(root);
	}
	return root;
}

export function prepareMarketSessionStorage(root) {
	const previousHome = process.env.HOME;
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	process.env.HOME = root;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	try {
		writeTreeseedMachineConfig(root, createDefaultTreeseedMachineConfig({
			tenantRoot: root,
			deployConfig: {
				name: 'Help Test',
				slug: 'help-test',
				siteUrl: 'https://example.com',
			},
			tenantConfig: undefined,
		}));
		unlockTreeseedSecretSessionWithPassphrase(root, 'test-passphrase', {
			createIfMissing: true,
			allowMigration: false,
		});
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousTransport === undefined) {
			delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
		} else {
			process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
		}
	}
}

export function remoteSeedEnv(root) {
	return {
		HOME: root,
		TREESEED_KEY_AGENT_TRANSPORT: 'inline',
		TREESEED_KEY_PASSPHRASE: 'test-passphrase',
	};
}

export function prepareLocalMarketSession(root) {
	prepareMarketSessionStorage(root);
	const previousHome = process.env.HOME;
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	const previousPassphrase = process.env.TREESEED_KEY_PASSPHRASE;
	process.env.HOME = root;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	process.env.TREESEED_KEY_PASSPHRASE = 'test-passphrase';
	try {
		setMarketSession(root, {
			marketId: 'local',
			accessToken: 'test-local-token',
			principal: {
				id: 'user-local',
				displayName: 'Local Seed User',
				scopes: ['auth:me', 'market'],
				roles: ['platform_admin'],
				permissions: ['*:*:*'],
			},
		});
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousTransport === undefined) {
			delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
		} else {
			process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
		}
		if (previousPassphrase === undefined) {
			delete process.env.TREESEED_KEY_PASSPHRASE;
		} else {
			process.env.TREESEED_KEY_PASSPHRASE = previousPassphrase;
		}
	}
}

export function remoteSeedWorkspace() {
	const root = seedWorkspace({ localService: false });
	prepareMarketSessionStorage(root);
	const previousHome = process.env.HOME;
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	const previousPassphrase = process.env.TREESEED_KEY_PASSPHRASE;
	process.env.HOME = root;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	process.env.TREESEED_KEY_PASSPHRASE = 'test-passphrase';
	try {
		setMarketSession(root, {
			marketId: 'central',
			accessToken: 'test-token',
			principal: {
				id: 'user-1',
				displayName: 'Seed User',
				scopes: ['auth:me', 'market'],
				roles: ['platform_admin'],
				permissions: ['*:*:*'],
			},
		});
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousTransport === undefined) {
			delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
		} else {
			process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
		}
		if (previousPassphrase === undefined) {
			delete process.env.TREESEED_KEY_PASSPHRASE;
		} else {
			process.env.TREESEED_KEY_PASSPHRASE = previousPassphrase;
		}
	}
	return root;
}

export async function withMockFetch(handler, action) {
	const previous = globalThis.fetch;
	globalThis.fetch = handler;
	try {
		return await action();
	} finally {
		globalThis.fetch = previous;
	}
}

export function jsonResponse(payload, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

export function remoteSeedPayload({ mode = 'plan', environments = ['staging'], summary = { create: 1, update: 0, unchanged: 0, skip: 1, delete: 0, error: 0 }, result = undefined } = {}) {
	return {
		ok: true,
		seed: 'treeseed',
		mode,
		environments,
		summary,
		actions: [
			{ action: 'create', kind: 'team', key: 'team:treeseed', label: 'TreeSeed', environments, payload: {} },
		],
		diagnostics: [],
		run: { id: 'seed-run-1', state: result?.blocked ? 'blocked' : 'completed', mode, seedName: 'treeseed' },
		...(result ? { result } : {}),
	};
}

export const CANONICAL_TREESEED_SEED = `
name: treeseed
version: 1
defaultEnvironments: [local]
environments: [local, staging, prod]
resources:
  teams:
    - key: team:treeseed
      slug: treeseed
      name: treeseed
      displayName: TreeSeed
      profileSummary: TreeSeed platform market, integrated package, and agent operations.
  projects:
    - key: project:treeseed/market
      team: team:treeseed
      slug: market
      name: TreeSeed Market
      kind: market_app
      repository:
        role: primary
        provider: github
        owner: knowledge-coop
        name: market
        gitUrl: https://github.com/knowledge-coop/market.git
        defaultBranch: main
        checkoutPath: .
      architecture:
        topology: single_repository_site
        rootPath: .
        sitePath: .
        contentPath: src/content
        contentRuntimeSource: r2_published_manifest
        localContentMaterialization: existing_path
        contentPublishTarget:
          kind: cloudflare_r2
          bucket: treeseed-content-local
          prefix: treeseed/market
          manifestPath: manifests/treeseed/market/latest.json
  repositoryHosts:
    - key: repository-host:treeseed/market-github
      team: team:treeseed
      provider: github
      name: knowledge-coop
      ownership: treeseed_managed
      accountLabel: Knowledge Coop GitHub organization
      organizationOrOwner: knowledge-coop
      defaultVisibility: public
      allowedProjectKinds: [market_app, package, knowledge_hub]
      status: active
  hubRepositories: []
  products:
    - key: product:treeseed/market-template
      team: team:treeseed
      kind: template
      slug: treeseed-market
      title: TreeSeed Market Starter
      summary: First-party TreeSeed market control plane starter bundle.
      visibility: public
      listingEnabled: true
      offerMode: free
      manifestKey: seeds/treeseed.yaml
      artifactKey: catalog/treeseed-market/1.0.0/template
      searchText: TreeSeed market control plane starter template
      metadata:
        provider: github
        owner: knowledge-coop
        repository: market
        gitUrl: https://github.com/knowledge-coop/market.git
  catalogArtifacts:
    - key: catalog-artifact:treeseed/market-template/1.0.0
      product: product:treeseed/market-template
      version: 1.0.0
      kind: template
      contentKey: catalog/treeseed-market/1.0.0/template
      manifestKey: seeds/treeseed.yaml
      metadata:
        provider: github
        owner: knowledge-coop
        repository: market
        gitUrl: https://github.com/knowledge-coop/market.git
`;

export const VALID_MINIMAL_SEED = `
name: demo
version: 1
defaultEnvironments: [local]
environments: [local, prod]
resources:
  teams:
    - key: team:demo
      slug: demo
      name: demo
  projects:
    - key: project:demo/site
      team: team:demo
      slug: site
      name: Demo Site
      repository:
        role: primary
        provider: github
        owner: knowledge-coop
        name: market
        gitUrl: https://github.com/knowledge-coop/market.git
        defaultBranch: main
      architecture:
        topology: single_repository_site
        rootPath: .
        sitePath: .
        contentPath: src/content
        contentRuntimeSource: local_directory
        localContentMaterialization: existing_path
        contentPublishTarget:
          kind: none
`;
