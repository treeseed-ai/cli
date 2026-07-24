import {
	createDefaultMachineConfig,
	unlockSecretSessionWithPassphrase,
	writeMachineConfig,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeWorkspaceRoot } from './cli-test-fixtures.ts';

export const { runCommandLine } = await import('../../dist/cli/main.js');
export const {
	buildCliClientEncryptedEscrowBody,
	summarizeCliClientEncryptedEscrow,
} = await import('../../dist/cli/configuration/secrets-escrow.js');

export function prepareMarketWorkspace({ withSession = true } = {}) {
	const root = makeWorkspaceRoot();
	const previousHome = process.env.HOME;
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	const previousPassphrase = process.env.TREESEED_KEY_PASSPHRASE;
	process.env.HOME = root;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	process.env.TREESEED_KEY_PASSPHRASE = 'test-passphrase';
	try {
		writeMachineConfig(root, createDefaultMachineConfig({
			tenantRoot: root,
			deployConfig: { name: 'Projects Deploy Test', slug: 'projects-deploy-test' },
			tenantConfig: undefined,
		}));
		unlockSecretSessionWithPassphrase(root, 'test-passphrase', {
			createIfMissing: true,
			allowMigration: false,
		});
		if (withSession) {
			setMarketSession(root, {
				marketId: 'local',
				accessToken: 'test-local-token',
				principal: {
					id: 'user-local',
					displayName: 'Local Deploy User',
					scopes: ['auth:me', 'market'],
					roles: ['platform_admin'],
					permissions: ['*:*:*'],
				},
			});
		}
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousTransport === undefined) delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
		else process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
		if (previousPassphrase === undefined) delete process.env.TREESEED_KEY_PASSPHRASE;
		else process.env.TREESEED_KEY_PASSPHRASE = previousPassphrase;
	}
	return root;
}

export async function runCli(args, options = {}) {
	const writes = [];
	const env = {
		...process.env,
		NODE_ENV: 'test',
		TREESEED_KEY_AGENT_TRANSPORT: 'inline',
		TREESEED_KEY_PASSPHRASE: 'test-passphrase',
		CI: undefined,
		ACT: undefined,
		GITHUB_ACTIONS: undefined,
		TREESEED_VERIFY_DRIVER: undefined,
		...(options.env ?? {}),
	};
	const previousEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	let exitCode;
	try {
		exitCode = await runCommandLine(args, {
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
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
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

export function deployment(overrides = {}) {
	return {
		id: 'dep_123',
		teamId: 'team-1',
		projectId: 'project-1',
		environment: 'staging',
		deploymentKind: 'code',
		action: 'deploy_web',
		status: 'queued',
		platformOperationId: 'op_123',
		retryOfDeploymentId: null,
		resumedFromDeploymentId: null,
		idempotencyKey: 'idem-1',
		requestedByUserId: 'user-1',
		sourceRef: null,
		releaseTag: null,
		commitSha: null,
		triggeredByType: 'cli',
		triggeredById: 'user-1',
		repository: { owner: 'treeseed-ai', name: 'market' },
		externalWorkflow: { url: 'https://github.com/treeseed-ai/market/actions/runs/1' },
		target: {
			url: 'https://staging.example.test',
			runnerToken: 'runner-token-secret',
			capacityProviderId: 'capacity-provider-secret',
		},
		monitor: {},
		summary: 'Queued deploy.',
		error: {},
		metadata: {},
		startedAt: '2026-05-01T10:00:00.000Z',
		finishedAt: null,
		createdAt: '2026-05-01T10:00:00.000Z',
		updatedAt: '2026-05-01T10:00:00.000Z',
		completedAt: null,
		...overrides,
	};
}

export function monitorResult(overrides = {}) {
	return {
		environment: 'staging',
		status: 'healthy',
		checkedAt: '2026-05-01T10:05:00.000Z',
		checks: [
			{ key: 'latest_workflow', label: 'Latest workflow', status: 'passed', summary: 'deploy-web.yml completed successfully.', source: 'github', inspectCommand: 'gh run view 1 --repo treeseed-ai/market --log-failed' },
			{ key: 'http_response', label: 'HTTP response', status: 'warning', summary: 'HTTP probe returned 503.', source: 'http', url: 'https://staging.example.test' },
			{ key: 'd1_migration', label: 'D1 migration', status: 'skipped', summary: 'No D1 migration result was reported.', source: 'sdk' },
		],
		urls: ['https://staging.example.test/'],
		warnings: ['HTTP probe returned 503.'],
		...overrides,
	};
}

export function queueResponse(overrides = {}) {
	const record = deployment(overrides);
	return {
		ok: true,
		deployment: record,
		operation: { id: record.platformOperationId, status: record.status },
		pollUrl: `/v1/platform/operations/${record.platformOperationId}`,
		eventsUrl: `/v1/projects/${record.projectId}/deployments/${record.id}/events`,
		stateUrl: `/v1/projects/${record.projectId}/deployment-state`,
	};
}

export function projectHostsPayload(overrides = {}) {
	return {
		projectId: 'project-1',
		teamId: 'team-1',
		launchRequirements: {
			hosts: [
				{
					kind: 'host',
					key: 'sourceRepository',
					type: 'repository',
					required: true,
					compatibleProviders: ['github'],
					displayName: 'Source repository',
					purpose: 'Creates repositories.',
				},
				{
					kind: 'host',
					key: 'publicWeb',
					type: 'web',
					required: true,
					compatibleProviders: ['cloudflare'],
					displayName: 'Public web',
					purpose: 'Deploys web.',
				},
			],
		},
		view: {
			summary: { status: 'ok', total: 2, warnings: 0, blocked: 0 },
			requirements: [
				{
					requirementKey: 'sourceRepository',
					required: true,
					type: 'repository',
					binding: { provider: 'github', hostId: 'repo-host-1', managedHostKey: null },
					audit: { status: 'ok' },
				},
				{
					requirementKey: 'publicWeb',
					required: true,
					type: 'web',
					binding: { provider: 'cloudflare', hostId: null, managedHostKey: 'treeseed-managed-web' },
					audit: { status: 'ok' },
				},
			],
			diagnostics: [],
		},
		...overrides,
	};
}

export function json(payload, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

export async function withFetch(handler, callback) {
	const calls = [];
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
		const call = { method: init.method ?? 'GET', path: url.pathname + url.search, body };
		calls.push(call);
		return handler(call);
	};
	try {
		return await callback(calls);
	} finally {
		globalThis.fetch = previousFetch;
	}
}
