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

