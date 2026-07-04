import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createDefaultTreeseedMachineConfig,
	unlockTreeseedSecretSessionWithPassphrase,
	writeTreeseedMachineConfig,
} from '@treeseed/sdk/workflow-support';
import { setMarketSession } from '@treeseed/sdk/market-client';
import { makeWorkspaceRoot } from './cli-test-fixtures.ts';

const { runTreeseedCli } = await import('../dist/cli/main.js');
const {
	buildCliClientEncryptedEscrowBody,
	summarizeCliClientEncryptedEscrow,
} = await import('../dist/cli/secrets-escrow.js');

function prepareMarketWorkspace({ withSession = true } = {}) {
	const root = makeWorkspaceRoot();
	const previousHome = process.env.HOME;
	const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
	const previousPassphrase = process.env.TREESEED_KEY_PASSPHRASE;
	process.env.HOME = root;
	process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
	process.env.TREESEED_KEY_PASSPHRASE = 'test-passphrase';
	try {
		writeTreeseedMachineConfig(root, createDefaultTreeseedMachineConfig({
			tenantRoot: root,
			deployConfig: { name: 'Projects Deploy Test', slug: 'projects-deploy-test' },
			tenantConfig: undefined,
		}));
		unlockTreeseedSecretSessionWithPassphrase(root, 'test-passphrase', {
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

async function runCli(args, options = {}) {
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

function deployment(overrides = {}) {
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

function monitorResult(overrides = {}) {
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

function queueResponse(overrides = {}) {
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

function projectHostsPayload(overrides = {}) {
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

function json(payload, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

async function withFetch(handler, callback) {
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

test('projects deploy, publish, and monitor post canonical deployment bodies', async () => {
	const root = prepareMarketWorkspace();
	await withFetch(() => json(queueResponse()), async (calls) => {
		const deploy = await runCli(['projects', 'deploy', 'project-1', '--market', 'local', '--environment', 'staging'], { cwd: root, env: { HOME: root } });
		const publish = await runCli(['projects', 'publish', 'project-1', '--market', 'local', '--environment', 'staging', '--reason', 'content refresh', '--idempotency-key', 'idem-publish'], { cwd: root, env: { HOME: root } });
		const monitor = await runCli(['projects', 'monitor', 'project-1', '--market', 'local', '--environment', 'staging'], { cwd: root, env: { HOME: root } });

		assert.equal(deploy.exitCode, 0);
		assert.equal(publish.exitCode, 0);
		assert.equal(monitor.exitCode, 0);
		assert.deepEqual(calls.map((call) => call.body), [
			{ environment: 'staging', action: 'deploy_web', source: 'cli' },
			{ environment: 'staging', action: 'publish_content', source: 'cli', reason: 'content refresh', idempotencyKey: 'idem-publish' },
			{ environment: 'staging', action: 'monitor', source: 'cli' },
		]);
		assert(calls.every((call) => call.path === '/v1/projects/project-1/deployments/web'));
	});
});

test('projects import plans and applies safe canonical repository import payloads', async () => {
	const root = prepareMarketWorkspace();
	await withFetch((call) => {
		if (call.path === '/repos/treeseed-ai/sdk') {
			return json({
				default_branch: 'main',
				private: false,
				html_url: 'https://github.com/treeseed-ai/sdk',
				clone_url: 'https://github.com/treeseed-ai/sdk.git',
			});
		}
		if (call.path === '/repos/treeseed-ai/sdk/git/trees/main?recursive=1') {
			return json({
				tree: [
					{ type: 'blob', path: 'package.json' },
					{ type: 'blob', path: 'treeseed.package.yaml' },
					{ type: 'blob', path: 'docs/index.md' },
					{ type: 'blob', path: 'docs/src/content/intro.md' },
					{ type: 'tree', path: 'docs' },
					{ type: 'tree', path: 'docs/src' },
					{ type: 'tree', path: 'docs/src/content' },
				],
			});
		}
		if (call.path === '/v1/teams/treeseed/projects/import') {
			return json({
				ok: true,
				payload: {
					project: { id: 'project-sdk', slug: 'sdk' },
					architecture: call.body.plan.architecture,
					hubRepository: { metadata: { credentialRef: call.body.plan.credentialRef } },
				},
			}, 201);
		}
		return json({ ok: false, error: `Unexpected path ${call.path}` }, 404);
	}, async (calls) => {
		const plan = await runCli(['projects', 'import', 'treeseed-ai/sdk', '--team', 'treeseed', '--plan', '--json'], {
			cwd: root,
			env: { HOME: root, TREESEED_GITHUB_TOKEN_TREESEED_AI_SDK: 'ghp_not-rendered' },
		});
		assert.equal(plan.exitCode, 0);
		const planned = JSON.parse(plan.stdout);
		assert.equal(planned.projectImport.architecture.sitePath, 'docs');
		assert.equal(planned.projectImport.architecture.contentPath, 'docs/src/content');
		assert.equal(planned.projectImport.credentialRef, 'env:TREESEED_GITHUB_TOKEN_TREESEED_AI_SDK');
		assert.doesNotMatch(plan.output, /ghp_not-rendered/u);

		const applied = await runCli(['projects', 'import', 'treeseed-ai/sdk', '--team', 'treeseed', '--market', 'local', '--execute', '--json'], {
			cwd: root,
			env: { HOME: root, TREESEED_GITHUB_TOKEN_TREESEED_AI_SDK: 'ghp_not-rendered' },
		});
		assert.equal(applied.exitCode, 0, applied.stderr || applied.output);
		const importCall = calls.find((call) => call.path === '/v1/teams/treeseed/projects/import');
		assert.equal(importCall.body.plan.architecture.sitePath, 'docs');
		assert.equal(importCall.body.plan.architecture.contentPath, 'docs/src/content');
		assert.equal(JSON.stringify(importCall.body).includes('ghp_not-rendered'), false);
		assert.doesNotMatch(applied.output, /ghp_not-rendered/u);
	});
});

test('projects hosts lists, audits, and queues replacement through canonical host binding API', async () => {
	const root = prepareMarketWorkspace();
	await withFetch((call) => {
		if (call.path === '/v1/projects/project-1/hosts' && call.method === 'GET') {
			return json({ ok: true, payload: projectHostsPayload() });
		}
		if (call.path === '/v1/projects/project-1/hosts/audit') {
			return json({ ok: true, payload: projectHostsPayload({ hostBindingAudit: { checkedAt: '2026-06-03T00:00:00.000Z' } }) });
		}
		if (call.path === '/v1/projects/project-1/hosts/publicWeb/replace') {
			return json({
				ok: true,
				payload: projectHostsPayload(),
				operation: { id: 'op-hosts-1', status: 'queued', pollUrl: '/v1/platform/operations/op-hosts-1' },
			}, 202);
		}
		return json({ ok: false, error: `Unexpected path ${call.path}` }, 404);
	}, async (calls) => {
		const list = await runCli(['projects', 'hosts', 'project-1', '--market', 'local'], { cwd: root, env: { HOME: root } });
		const audit = await runCli(['projects', 'hosts', 'audit', 'project-1', '--market', 'local'], { cwd: root, env: { HOME: root } });
		const replace = await runCli(['projects', 'hosts', 'replace', 'project-1', '--market', 'local', '--host', 'publicWeb=cloudflare:web-host-2'], { cwd: root, env: { HOME: root } });

		assert.equal(list.exitCode, 0);
		assert.match(list.stdout, /Treeseed project host bindings/u);
		assert.equal(audit.exitCode, 0);
		assert.match(audit.stdout, /Treeseed project host audit/u);
		assert.equal(replace.exitCode, 0);
		assert.match(replace.stdout, /Treeseed project host replace queued/u);
		const replaceCall = calls.find((call) => call.path === '/v1/projects/project-1/hosts/publicWeb/replace');
		assert.equal(replaceCall.body.hostBinding.hostId, 'web-host-2');
		assert.equal(replaceCall.body.hostBinding.provider, 'cloudflare');
		assert.equal(JSON.stringify(replaceCall.body).includes('passphrase'), false);
	});
});

test('production deploy and publish require --yes before calling the API', async () => {
	const root = prepareMarketWorkspace();
	await withFetch(() => json(queueResponse({ environment: 'prod' })), async (calls) => {
		const blocked = await runCli(['projects', 'deploy', 'project-1', '--market', 'local', '--environment', 'prod'], { cwd: root, env: { HOME: root } });
		assert.equal(blocked.exitCode, 1);
		assert.match(blocked.stderr, /requires --yes/u);
		assert.equal(calls.length, 0);

		const confirmed = await runCli(['projects', 'publish', 'project-1', '--market', 'local', '--environment', 'prod', '--yes'], { cwd: root, env: { HOME: root } });
		assert.equal(confirmed.exitCode, 0);
		assert.deepEqual(calls[0].body, {
			environment: 'prod',
			action: 'publish_content',
			source: 'cli',
			confirmProduction: true,
		});
	});
});

test('projects deployments lists human and JSON output without forbidden fields', async () => {
	const root = prepareMarketWorkspace();
	await withFetch(() => json({ ok: true, payload: [deployment({ status: 'succeeded', completedAt: '2026-05-01T10:10:00.000Z' })] }), async () => {
		const human = await runCli(['projects', 'deployments', 'project-1', '--market', 'local'], { cwd: root, env: { HOME: root } });
		assert.equal(human.exitCode, 0);
		assert.match(human.stdout, /Treeseed project deployments/u);
		assert.match(human.stdout, /dep_123/u);
		assert.doesNotMatch(human.output, /runner-token-secret|capacity-provider-secret|runnerToken|capacityProviderId/u);

		const jsonResult = await runCli(['projects', 'deployments', 'project-1', '--market', 'local', '--json'], { cwd: root, env: { HOME: root } });
		assert.equal(jsonResult.exitCode, 0);
		const report = JSON.parse(jsonResult.stdout);
		assert.equal(report.deployments[0].id, 'dep_123');
		assert.equal(JSON.stringify(report).includes('runner-token-secret'), false);
		assert.equal(JSON.stringify(report).includes('capacityProviderId'), false);
	});
});

test('projects deployment inspects detail and ordered events', async () => {
	const root = prepareMarketWorkspace();
	await withFetch((call) => {
		if (call.path.endsWith('/events')) {
			return json({ ok: true, payload: [
				{ id: 'event-1', deploymentId: 'dep_123', projectId: 'project-1', teamId: 'team-1', operationId: 'op_123', kind: 'deployment.requested', message: 'Requested.', status: 'queued', severity: 'info', sequence: 1, createdAt: '2026-05-01T10:00:00.000Z' },
				{ id: 'event-2', deploymentId: 'dep_123', projectId: 'project-1', teamId: 'team-1', operationId: 'op_123', kind: 'deployment.succeeded', message: 'Succeeded.', status: 'succeeded', severity: 'info', sequence: 2, createdAt: '2026-05-01T10:01:00.000Z' },
			] });
		}
		return json({ ok: true, payload: deployment({ status: 'succeeded', monitor: monitorResult(), completedAt: '2026-05-01T10:01:00.000Z' }) });
	}, async () => {
		const result = await runCli(['projects', 'deployment', 'project-1', 'dep_123', '--market', 'local'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Treeseed project deployment/u);
		assert.match(result.stdout, /deployment.requested/u);
		assert.match(result.stdout, /deployment.succeeded/u);
		assert.match(result.stdout, /Monitor checks/u);
		assert.match(result.stdout, /latest_workflow/u);
		assert.doesNotMatch(result.output, /runner-token-secret|capacity-provider-secret|runnerToken|capacityProviderId/u);
	});
});

test('projects monitor --wait prints compact monitor checks and JSON monitor result', async () => {
	const root = prepareMarketWorkspace();
	let pollCount = 0;
	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ action: 'monitor', status: 'queued' }), 202);
		pollCount += 1;
		return json({
			ok: true,
			payload: deployment({
				action: 'monitor',
				status: pollCount < 2 ? 'monitoring' : 'succeeded',
				monitor: pollCount < 2 ? {} : monitorResult({ status: 'degraded' }),
				completedAt: pollCount < 2 ? null : '2026-05-01T10:05:00.000Z',
			}),
		});
	}, async () => {
		const human = await runCli(['projects', 'monitor', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(human.exitCode, 0);
		assert.match(human.stdout, /Monitor checks/u);
		assert.match(human.stdout, /warning\s+http_response\s+HTTP probe returned 503/u);

		pollCount = 0;
		const machine = await runCli(['projects', 'monitor', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--poll-interval-ms', '1', '--json'], { cwd: root, env: { HOME: root } });
		assert.equal(machine.exitCode, 0);
		const report = JSON.parse(machine.stdout);
		assert.equal(report.deployment.monitor.status, 'degraded');
		assert.equal(report.deployment.monitor.checks[1].key, 'http_response');
		assert.equal(JSON.stringify(report).includes('capacityProviderId'), false);
	});
});

test('projects monitor --wait exits failed, timed out, and cancelled with stable codes', async () => {
	const root = prepareMarketWorkspace();
	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ action: 'monitor', status: 'queued' }), 202);
		return json({
			ok: true,
			payload: deployment({
				action: 'monitor',
				status: 'failed',
				monitor: monitorResult({
					status: 'failed',
					checks: [
						{ key: 'http_response', label: 'HTTP response', status: 'failed', summary: 'HTTP probe returned 404.', source: 'http' },
					],
				}),
				completedAt: '2026-05-01T10:05:00.000Z',
			}),
		});
	}, async () => {
		const result = await runCli(['projects', 'monitor', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 3);
		assert.match(result.stdout, /failed\s+http_response/u);
	});

	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ action: 'monitor', status: 'queued' }), 202);
		return json({ ok: true, payload: deployment({ action: 'monitor', status: 'monitoring' }) });
	}, async () => {
		const result = await runCli(['projects', 'monitor', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--timeout-seconds', '0.001', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 4);
	});

	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ action: 'monitor', status: 'queued' }), 202);
		return json({ ok: true, payload: deployment({ action: 'monitor', status: 'cancelled' }) });
	}, async () => {
		const result = await runCli(['projects', 'monitor', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 5);
	});
});

test('retry, resume, and cancel use deployment mutation routes and stable exit codes', async () => {
	const root = prepareMarketWorkspace();
	await withFetch((call) => {
		if (call.path.endsWith('/retry')) {
			return json({ ok: true, originalDeployment: deployment({ status: 'failed' }), retryDeployment: deployment({ id: 'dep_retry', status: 'queued' }), operation: { id: 'op_retry', status: 'queued' } }, 202);
		}
		if (call.path.endsWith('/resume')) {
			return json({ ok: false, error: { code: 'operation_not_retryable', message: 'Deployment resume is not supported until runner checkpoints are implemented.' } }, 409);
		}
		if (call.path.endsWith('/cancel')) {
			return json({ ok: true, deployment: deployment({ status: 'cancelled' }), cancellation: 'completed' });
		}
		return json({ ok: true });
	}, async (calls) => {
		const retry = await runCli(['projects', 'deployment', 'retry', 'project-1', 'dep_123', '--market', 'local'], { cwd: root, env: { HOME: root } });
		const resume = await runCli(['projects', 'deployment', 'resume', 'project-1', 'dep_123', '--market', 'local'], { cwd: root, env: { HOME: root } });
		const cancel = await runCli(['projects', 'deployment', 'cancel', 'project-1', 'dep_123', '--market', 'local'], { cwd: root, env: { HOME: root } });

		assert.equal(retry.exitCode, 0);
		assert.equal(resume.exitCode, 1);
		assert.match(resume.output, /resume is not supported/u);
		assert.equal(cancel.exitCode, 5);
		assert.deepEqual(calls.map((call) => call.path), [
			'/v1/projects/project-1/deployments/dep_123/retry',
			'/v1/projects/project-1/deployments/dep_123/resume',
			'/v1/projects/project-1/deployments/dep_123/cancel',
		]);
	});
});

test('projects deploy --wait polls until terminal states and timeout', async () => {
	const root = prepareMarketWorkspace();
	let pollCount = 0;
	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ status: 'queued' }), 202);
		pollCount += 1;
		return json({ ok: true, payload: deployment({ status: pollCount < 2 ? 'running' : 'succeeded', completedAt: pollCount < 2 ? null : '2026-05-01T10:02:00.000Z' }) });
	}, async () => {
		const result = await runCli(['projects', 'deploy', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /completed/u);
		assert(pollCount >= 2);
	});

	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ status: 'queued' }), 202);
		return json({ ok: true, payload: deployment({ status: 'running' }) });
	}, async () => {
		const result = await runCli(['projects', 'deploy', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--timeout-seconds', '0.001', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 4);
		assert.match(result.stdout, /wait timed out/u);
	});

	await withFetch((call) => {
		if (call.method === 'POST') return json(queueResponse({ status: 'queued' }), 202);
		return json({ ok: true, payload: deployment({ status: 'failed', error: { summary: 'Workflow failed.', inspectCommand: 'gh run view 1' } }) });
	}, async () => {
		const result = await runCli(['projects', 'deploy', 'project-1', '--market', 'local', '--environment', 'staging', '--wait', '--poll-interval-ms', '1'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 3);
		assert.match(result.stdout, /deployment failed/u);
		assert.match(result.stdout, /trsd projects deployment retry project-1 dep_123/u);
	});
});

test('projects deployment commands report missing auth with exit code 2', async () => {
	const root = prepareMarketWorkspace({ withSession: false });
	await withFetch(() => {
		throw new Error('fetch should not be called without auth');
	}, async () => {
		const result = await runCli(['projects', 'deployments', 'project-1', '--market', 'local'], { cwd: root, env: { HOME: root } });
		assert.equal(result.exitCode, 2);
		assert.match(result.stderr, /auth:login --market local/u);
	});
});

test('client-encrypted escrow helpers produce ciphertext-only bodies and safe status labels', () => {
	const body = buildCliClientEncryptedEscrowBody({
		id: 'escrow-1',
		secretId: 'secret-1',
		name: 'TREESEED_PROJECT_SECRET',
		secretClass: 'customer_project_secret',
		ciphertext: 'base64-ciphertext',
		ciphertextRef: 'api://projects/project-1/secrets/escrow/escrow-1',
		algorithm: 'xchacha20-poly1305',
		nonce: 'base64-nonce',
		salt: 'base64-salt',
		kdf: 'argon2id',
		kdfParams: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
		wrappingKeyId: 'client-key-1',
		encryptionVersion: 'v1',
		deploymentIntent: { targetMode: 'github_actions_secret_enclave' },
	});

	assert.equal(body.recoveryPolicy, 'reentry_required');
	assert.equal(body.ciphertext, 'base64-ciphertext');
	assert.equal(JSON.stringify(body).includes('passphrase'), false);
	assert.throws(() => buildCliClientEncryptedEscrowBody({
		...body,
		passphrase: 'do-not-send',
	}));
	assert.deepEqual(summarizeCliClientEncryptedEscrow({
		...body,
		status: 'active',
		expiresAt: '2026-01-01T00:00:00.000Z',
	}, new Date('2026-06-17T00:00:00.000Z')), {
		status: 'reentry_required',
		escrowed: true,
		migrated: false,
		expired: true,
		tombstoned: false,
		reentryRequired: true,
		migrationTarget: null,
		expiresAt: '2026-01-01T00:00:00.000Z',
		label: 're-entry required',
	});
});
