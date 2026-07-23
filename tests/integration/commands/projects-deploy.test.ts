import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildCliClientEncryptedEscrowBody,
	deployment,
	json,
	monitorResult,
	prepareMarketWorkspace,
	projectHostsPayload,
	queueResponse,
	runCli,
	summarizeCliClientEncryptedEscrow,
	withFetch,
} from '../../support/projects-command-harness.ts';

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

