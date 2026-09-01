import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { listCommandPaths, TREESEED_COMMAND_TREE_V1 } from '@treeseed/sdk/operator-contracts';
import { commandSpecs } from '../../../src/cli/registry.ts';
import { runCommandLine } from '../../../src/cli/runtime.ts';
import { handoffProviderEnrollment } from '../../../src/cli/support/provider-enrollment.ts';
import { loadServerSession, saveServerProfile, saveServerSession } from '../../../src/cli/support/server-custody.ts';

test('registry exactly matches the SDK command tree', () => {
	assert.deepEqual(commandSpecs.map((command) => command.name), listCommandPaths(TREESEED_COMMAND_TREE_V1));
	assert.equal(commandSpecs.some((command) => command.name.includes(':')), false);
});

test('send derives project-qualified recipients without a project option or raw routes', async () => {
	const calls: Array<{ operationId: string; input: unknown }> = []; const output: string[] = [];
	const exit = await runCommandLine(['send', 'engineering', '@sdk/architect\n\nHow should this work?', '--team', 'team-1', '--to', 'sdk/architect', '--no-wait', '--json'], {
		interactiveUi: false, operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { sendId: 'send-1', status: 'queued' } }; }, write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(calls, [{ operationId: 'communications.send', input: { path: { teamId: 'team-1', channel: 'engineering' }, query: {}, body: { message: '@sdk/architect\n\nHow should this work?', recipients: ['sdk/architect'] } } }]);
	assert.equal(JSON.parse(output[0]!).result.sendId, 'send-1');
});

test('teams use persists the active team and team commands inherit it', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-team-')); const output: string[] = [];
	const env = { TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: 'http://127.0.0.1:3002' };
	try {
		saveServerSession({ serverId: 'local', audience: 'http://127.0.0.1:3002', accessToken: 'token', principal: { id: 'user-1' } as any }, env);
		const invoke = async (operationId: string, input: any) => operationId === 'teams.list'
			? { data: { items: [{ id: 'team-1', slug: 'treeseed', name: 'TreeSeed' }] } }
			: { data: { operationId, teamId: input.path.teamId } };
		assert.equal(await runCommandLine(['teams', 'use', 'treeseed', '--json'], { env, interactiveUi: false, operationInvoke: invoke, write: (value) => output.push(value) }), 0);
		assert.equal(loadServerSession('local', env)?.activeTeam?.id, 'team-1');
		assert.equal(await runCommandLine(['capacity', 'status', '--json'], { env, interactiveUi: false, operationInvoke: invoke, write: (value) => output.push(value) }), 0);
		assert.equal(JSON.parse(output.at(-1)!).result.teamId, 'team-1');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('leaf commands expose only catalog-derived high-level options', () => {
	const byName = new Map(commandSpecs.map((command) => [command.name, command.options.map((option) => option.flag)]));
	assert.deepEqual(byName.get('workdays start'), ['--server', '--team', '--preflight', '--digest', '--yes', '--json', '--plan']);
	assert.deepEqual(byName.get('plans show'), ['--server', '--json']);
	assert.deepEqual(byName.get('agents show'), ['--server', '--project', '--json']);
	assert.deepEqual(byName.get('host status'), ['--server', '--json']);
	assert.deepEqual(byName.get('host provider environment set'), ['--server', '--yes', '--json', '--plan', '--stdin']);
	assert.deepEqual(byName.get('providers registration code rotate'), ['--server', '--team', '--yes', '--json', '--plan']);
	assert.deepEqual(byName.get('providers environments grant'), ['--server', '--team', '--yes', '--json', '--plan', '--input']);
	assert.equal(commandSpecs.some((command) => command.options.some((option) => option.flag === '--execute' || option.flag === '--market')), false);
});

test('host commands preserve the SDK handler boundary and stable envelope', async () => {
	const calls: unknown[] = []; const output: string[] = [];
	const exit = await runCommandLine(['host', 'component', 'status', 'agent', '--server', 'lab', '--json'], {
		interactiveUi: false, hostInvoke: async (input) => { calls.push(input); return { componentId: 'agent', healthy: true }; }, write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(calls, [{ handlerId: 'local.host.component.status', arguments: ['agent'], options: {} }]);
	assert.deepEqual(JSON.parse(output[0]!).result, { componentId: 'agent', healthy: true });
});

test('AI mode commands use the same bounded host-manager authority', async () => {
	const calls: unknown[] = []; const output: string[] = [];
	const exit = await runCommandLine(['ai', 'mode', 'set', 'sleep', '--idempotency-key', 'cycle-1', '--drain-timeout', '120', '--yes', '--json'], {
		interactiveUi: false, hostInvoke: async (input) => { calls.push(input); return { state: 'succeeded', to: 'sleep' }; }, write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(calls, [{ handlerId: 'local.host.ai.mode.set', arguments: ['sleep'], options: { idempotencyKey: 'cycle-1', drainTimeout: '120' } }]);
	assert.equal(JSON.parse(output[0]!).result.to, 'sleep');
});

test('host configuration adoption sends validated content and requires explicit confirmation', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-host-config-'));
	const file = resolve(root, 'host.json');
	writeFileSync(file, JSON.stringify({ schemaVersion: 'treeseed.host/v1', configurationId: 'development-workstation', generation: 1, host: { id: 'workstation-01', role: 'integrated', architecture: 'amd64' }, runtime: { management: 'managed', environment: 'development', dataRoot: resolve(root, '.treeseed/data') }, updates: { defaultTrack: 'development', stable: { metadataPollSeconds: 86400, maintenanceWindow: { weekday: 'sunday', localTime: '03:00', jitterMinutes: 20 } }, development: { pollSeconds: 60 } }, components: {}, network: { manager: { binding: '127.0.0.1:4790', aliases: [], sans: [], trustedLanCidrs: [] } }, fleet: { rolloutGroup: 'development-workstation', receiptReporting: { enabled: false, intervalSeconds: 300 } }, secrets: {} }));
	const calls: any[] = [];
	try {
		const blocked = await runCommandLine(['host', 'config', 'adopt', file, '--json'], { interactiveUi: false, hostInvoke: async (value) => calls.push(value), write() {} });
		assert.equal(blocked, 1);
		const accepted = await runCommandLine(['host', 'config', 'adopt', file, '--confirm', '--json'], { interactiveUi: false, hostInvoke: async (value) => { calls.push(value); return { adopted: true }; }, write() {} });
		assert.equal(accepted, 0);
		assert.equal(calls[0]?.handlerId, 'local.host.config.adopt');
		assert.equal(calls[0]?.options.confirm, true);
		assert.equal(calls[0]?.configuration.configurationId, 'development-workstation');
		assert.deepEqual(calls[0]?.arguments, []);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('host identity adoption is permanently bound to the protected local socket', async () => {
	const { hostUsesProtectedLocalTransport } = await import('../../../src/cli/commands/host.ts');
	assert.equal(hostUsesProtectedLocalTransport({ command: { name: 'host config adopt' } as any }), true);
	assert.equal(hostUsesProtectedLocalTransport({ command: { name: 'host reset' } as any }), true);
	assert.equal(hostUsesProtectedLocalTransport({ command: { name: 'host config apply' } as any }), false);
});

test('host storage connect derives the active team and keeps bootstrap authority out of output', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-storage-')); const calls: any[] = []; const output: string[] = [];
	const env = { TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: 'http://127.0.0.1:3002' };
	try {
		saveServerSession({ serverId: 'local', audience: 'http://127.0.0.1:3002', accessToken: 'session', principal: { id: 'user-1' } as any,
			activeTeam: { id: '16549507-cebc-4a16-94c5-cf91defbd6a3', slug: 'treeseed', name: 'TreeSeed' } }, env);
		const exit = await runCommandLine(['host', 'storage', 'connect', 'cloudflare-r2', '--json'], {
			env, interactiveUi: false, promptSecret: async () => 'bootstrap-token-secret-value',
			hostInvoke: async (input) => { calls.push(input); return { backend: 'cloudflare-r2', configured: true }; },
			write: (value) => output.push(value),
		});
		assert.equal(exit, 0);
		const payload = JSON.parse(calls[0].options.payload);
		assert.deepEqual({ action: payload.action, backend: payload.backend, teamId: payload.teamId, teamSlug: payload.teamSlug }, {
			action: 'connect', backend: 'cloudflare-r2', teamId: '16549507-cebc-4a16-94c5-cf91defbd6a3', teamSlug: 'treeseed',
		});
		assert.equal(payload.bootstrapToken, 'bootstrap-token-secret-value');
		assert.doesNotMatch(output.join(''), /bootstrap-token-secret-value/u);
		const progress: string[] = [];
		assert.equal(await runCommandLine(['host', 'storage', 'connect', 'cloudflare-r2'], {
			env, interactiveUi: true, promptSecret: async () => 'another-bootstrap-secret-value',
			hostInvoke: async () => ({ backend: 'cloudflare-r2', configured: true }),
			write: (value, stream) => { if (stream === 'stderr') progress.push(value); },
		}), 0);
		assert.match(progress.join(''), /Account API Tokens: Write/u);
		assert.match(progress.join(''), /Provisioning storage/u);
		assert.match(progress.join(''), /setup completed/u);
		assert.doesNotMatch(progress.join(''), /another-bootstrap-secret-value/u);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('generic local confirmation is reserved for destructive operations', async () => {
	let prompts = 0;
	const confirm = async () => { prompts += 1; return true; };
	assert.equal(await runCommandLine(['host', 'update', 'apply', '--json'], {
		interactiveUi: true, confirm, hostInvoke: async () => ({ checked: true }), write() {},
	}), 0);
	assert.equal(prompts, 0);
	assert.equal(await runCommandLine(['host', 'component', 'disable', 'api', '--json'], {
		interactiveUi: true, confirm, hostInvoke: async () => ({ disabled: true }), write() {},
	}), 0);
	assert.equal(prompts, 1);
});

test('bootstrap enrollment stores credentials privately and never emits key material', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-host-')); const output: string[] = [];
	try {
		const exit = await runCommandLine(['host', 'bootstrap', 'enroll', '--server', 'https://manager.treeseed.localhost', '--yes', '--json'], {
			env: { XDG_CONFIG_HOME: root }, interactiveUi: false,
			hostInvoke: async () => ({ clientId: 'client-test', privateKey: 'PRIVATE', certificate: 'CERTIFICATE', certificateAuthority: 'CA' }),
			write: (value) => output.push(value),
		});
		assert.equal(exit, 0);
		const rendered = output[0]!;
		assert.doesNotMatch(rendered, /PRIVATE|CERTIFICATE/u);
		const directory = resolve(root, 'treeseed', 'hosts', 'local');
		assert.equal(readFileSync(resolve(directory, 'client.key'), 'utf8'), 'PRIVATE');
		assert.equal(existsSync(resolve(directory, 'client.crt')), true);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('removed legacy commands are unknown without mutation', async () => {
	const output: string[] = [];
	for (const argv of [['capacity', 'capacity-plan-create'], ['agent-deploy'], ['content-integrate'], ['dev', 'start'], ['treedx', 'sync']]) {
		const exit = await runCommandLine([...argv, '--json'], { interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 1);
		assert.equal(JSON.parse(output.pop()!).error.category, 'unknown_command');
	}
});

test('plan mode prevents mutation operation invocation', async () => {
	const output: string[] = [];
	let invocations = 0;
	const exit = await runCommandLine(['workdays', 'start', '--team', 'team-1', '--preflight', 'p1', '--digest', 'sha256:x', '--plan', '--json'], { interactiveUi: false, operationInvoke: async () => { invocations += 1; }, write: (value) => output.push(value) });
	assert.equal(exit, 0);
	assert.equal(invocations, 0);
	assert.equal(JSON.parse(output[0]!).result.mutation, false);
});

test('plan mode is non-mutating for local credential custody', async () => {
	const output: string[] = [];
	const exit = await runCommandLine(['auth', 'logout', '--plan', '--server', 'local', '--json'], { interactiveUi: false, write: (value) => output.push(value) });
	assert.equal(exit, 0);
	assert.deepEqual(JSON.parse(output[0]!).result, { action: 'auth logout', mutation: false, authority: 'local_credential_custody' });
});

test('remote commands invoke exactly one SDK operation without a URL', async () => {
	const invocations: Array<{ operationId: string; input: unknown }> = [];
	const output: string[] = [];
	const exit = await runCommandLine(['capacity', 'status', '--team', 'team-1', '--json'], {
		interactiveUi: false,
		operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { data: { source: 'api' } }; },
		write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(JSON.parse(output[0]!).result, { source: 'api' });
	assert.deepEqual(invocations, [{ operationId: 'capacity.status', input: { path: { teamId: 'team-1' }, query: {}, body: undefined } }]);
});

test('library commands resolve project slugs and the bound TreeDX repository', async () => {
	const invocations: Array<{ operationId: string; input: any }> = []; const output: string[] = [];
	const exit = await runCommandLine(['library', 'read', 'sdk', 'agents/guide-steward.md', '--ref', 'refs/heads/staging', '--json'], {
		interactiveUi: false,
		operationInvoke: async (operationId, input) => {
			invocations.push({ operationId, input });
			if (operationId === 'projects.list') return { data: { items: [{ id: 'project-sdk', slug: 'sdk', name: 'SDK' }] } };
			if (operationId === 'treedx.library.show') return { data: { repositoryId: 'repo-sdk', contentRepositoryRef: 'refs/heads/staging', contentPath: '.' } };
			return { data: { files: [{ path: 'agents/guide-steward.md', content: 'agent' }], resolvedRef: 'a'.repeat(40) } };
		}, write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	assert.deepEqual(invocations.map((entry) => entry.operationId), ['projects.list', 'treedx.library.show', 'treedx.repositories.files.read']);
	assert.deepEqual(invocations[2]!.input, { path: { projectId: 'project-sdk', repoId: 'repo-sdk' }, query: {}, body: { ref: 'refs/heads/staging', paths: ['agents/guide-steward.md'], encoding: 'utf8', parseFrontmatter: true } });
	assert.equal(JSON.parse(output[0]!).result.files[0].path, 'agents/guide-steward.md');
});

test('library status checks the search index at the configured library ref', async () => {
	const invocations: Array<{ operationId: string; input: any }> = []; const output: string[] = [];
	const exit = await runCommandLine(['library', 'status', 'sdk', '--json'], {
		interactiveUi: false,
		operationInvoke: async (operationId, input) => {
			invocations.push({ operationId, input });
			if (operationId === 'projects.list') return { data: { items: [{ id: 'project-sdk', slug: 'sdk', name: 'SDK' }] } };
			if (operationId === 'treedx.library.show') return { data: { repositoryId: 'repo-sdk', contentRepositoryRef: 'refs/remotes/origin/staging', contentPath: '.' } };
			return { data: { ok: true } };
		}, write: (value) => output.push(value),
	});
	assert.equal(exit, 0);
	const index = invocations.find((entry) => entry.operationId === 'treedx.repositories.search.index.status');
	assert.deepEqual(index?.input.query, { ref: 'refs/remotes/origin/staging' });
});

test('seed commands upload parsed portable bundles instead of API-local paths', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-seed-'));
	const file = resolve(root, 'treeseed.yaml');
	writeFileSync(file, `schemaVersion: treeseed.seed-bundle/v3\nname: treeseed\nversion: 1\ndescription: test\nenvironments: [local]\ndigest: sha256:${'0'.repeat(64)}\nresources:\n  teams: []\n  memberships: []\n  projects: []\n  repositories: []\nruntime:\n  capacityProviders: []\n`);
	const invocations: Array<{ operationId: string; input: any }> = [];
	try {
		const exit = await runCommandLine(['seeds', 'validate', file, '--json'], { cwd: root, interactiveUi: false,
			operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { data: { ok: true } }; }, write: () => undefined });
		assert.equal(exit, 0);
		assert.equal(invocations[0]?.operationId, 'seeds.validate');
		assert.deepEqual(invocations[0]?.input.path, {});
		assert.equal(invocations[0]?.input.body.bundle.schemaVersion, 'treeseed.seed-bundle/v3');
		assert.equal('file' in invocations[0]?.input.body, false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('seed plan derives the path identity from the uploaded portable bundle', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-seed-plan-'));
	const file = resolve(root, 'treeseed.yaml');
	writeFileSync(file, `schemaVersion: treeseed.seed-bundle/v3\nname: treeseed\nversion: 1\ndescription: test\nenvironments: [local]\ndigest: sha256:${'0'.repeat(64)}\nresources:\n  teams: []\n  memberships: []\n  projects: []\n  repositories: []\nruntime:\n  capacityProviders: []\n`);
	const invocations: any[] = [];
	try {
		const exit = await runCommandLine(['seeds', 'plan', file, '--json'], { interactiveUi: false,
			operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { planned: true }; }, write() {} });
		assert.equal(exit, 0);
		assert.equal(invocations[0]?.operationId, 'seeds.plan');
		assert.equal(invocations[0]?.input.path.name, 'treeseed');
		assert.equal(invocations[0]?.input.body.bundle.name, 'treeseed');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('body-bearing catalog operations receive an empty object when no fields are supplied', async () => {
	const invocations: Array<{ operationId: string; input: any }> = [];
	const exit = await runCommandLine(['seeds', 'verify', 'treeseed', '--json'], {
		interactiveUi: false,
		operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { verified: false }; },
		write() {},
	});
	assert.equal(exit, 0);
	assert.deepEqual(invocations, [{
		operationId: 'seeds.verify',
		input: { path: { name: 'treeseed' }, query: {}, body: {} },
	}]);
});

test('seed verify accepts a portable bundle path and derives its seed identity', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-seed-verify-'));
	const file = resolve(root, 'treeseed.yaml');
	writeFileSync(file, `schemaVersion: treeseed.seed-bundle/v3\nname: treeseed\nversion: 1\ndescription: test\nenvironments: [local]\ndigest: sha256:${'0'.repeat(64)}\nresources:\n  teams: []\n  memberships: []\n  projects: []\n  repositories: []\nruntime:\n  capacityProviders: []\n`);
	const invocations: Array<{ operationId: string; input: any }> = [];
	try {
		const exit = await runCommandLine(['seeds', 'verify', file, '--json'], {
			interactiveUi: false,
			operationInvoke: async (operationId, input) => { invocations.push({ operationId, input }); return { verified: true }; },
			write() {},
		});
		assert.equal(exit, 0);
		assert.equal(invocations.length, 1);
		assert.equal(invocations[0]?.operationId, 'seeds.verify');
		assert.equal(invocations[0]?.input.path.name, 'treeseed');
		assert.equal(invocations[0]?.input.body.bundle.name, 'treeseed');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('provider enrollment hands the unwrapped API receipt to trusted local custody', async () => {
	let requestBody = '';
	const server = createServer((request, response) => {
		request.on('data', (chunk) => { requestBody += String(chunk); });
		request.on('end', () => {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ data: { teamId: 'team-1', enrollmentToken: 'one-time' } }));
		});
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-provider-enrollment-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		const profile = { serverId: 'test', label: 'Test', baseUrl: `http://127.0.0.1:${address.port}` };
		saveServerProfile(profile, env);
		saveServerSession({ serverId: 'test', audience: profile.baseUrl, accessToken: 'access-token' }, env);
		const handoffs: Record<string, unknown>[] = [];
		const output: string[] = [];
		const exit = await runCommandLine(['providers', 'connect', '--server', 'test', '--team', 'team-1', '--yes', '--json'], {
			env, interactiveUi: false,
			providerEnrollmentHandoff: async (input) => { handoffs.push(input); return { requestId: 'request-1' }; },
			write: (value) => output.push(value),
		});
		assert.equal(exit, 0);
		assert.equal(requestBody, '{}');
		assert.equal(handoffs[0]?.enrollmentToken, 'one-time');
		assert.deepEqual(JSON.parse(output[0]!).result, {
			teamId: 'team-1', connectionState: 'approval_required', provider: { requestId: 'request-1' },
		});
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});

test('seed apply enrolls, owner-approves, and waits for execution-ready provider closure', async () => {
	const paths: string[] = [];
	const server = createServer((request, response) => {
		request.resume(); request.on('end', () => {
			paths.push(request.url ?? ''); response.setHeader('content-type', 'application/json');
			if (request.url?.endsWith('/apply')) response.end(JSON.stringify({ data: { seed: 'treeseed', result: { providerClosure: { status: 'waiting_provider', receipts: [{
				key: 'capacity-provider:treeseed/local', status: 'enrollment_required', approval: 'trusted-local-owner', teamId: 'team-1', connectionId: 'local-team-1', enrollmentToken: 'one-time',
			}] } } } }));
			else if (request.url?.includes('/capacity-provider-requests/')) response.end(JSON.stringify({ data: { status: 'approved' } }));
			else response.end(JSON.stringify({ data: { seed: 'treeseed', result: { providerClosure: { status: 'verified', receipts: [{ status: 'verified' }] } } } }));
		});
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-seed-provider-')); const file = resolve(root, 'treeseed.yaml');
	writeFileSync(file, `schemaVersion: treeseed.seed-bundle/v3\nname: treeseed\nversion: 4\ndescription: test\nenvironments: [local]\ndigest: sha256:${'0'.repeat(64)}\nresources: { teams: [], memberships: [], projects: [], repositories: [] }\nruntime: { capacityProviders: [] }\n`);
	const env = { TREESEED_CONFIG_HOME: root, TREESEED_SEED_PROVIDER_TIMEOUT_SECONDS: '10' };
	try {
		const profile = { serverId: 'test', label: 'Test', baseUrl: `http://127.0.0.1:${address.port}` }; saveServerProfile(profile, env); saveServerSession({ serverId: 'test', audience: profile.baseUrl, accessToken: 'access-token' }, env);
		const handoffs: Record<string, unknown>[] = []; const output: string[] = [];
		const exit = await runCommandLine(['seeds', 'apply', file, '--server', 'test', '--yes', '--json'], { env, interactiveUi: false,
			providerEnrollmentHandoff: async (input) => { handoffs.push(input); return input.action === 'begin' ? { requestId: 'request-1' } : { status: 'connected' }; }, write: (value) => output.push(value) });
		assert.equal(exit, 0); assert.deepEqual(handoffs.map((entry) => entry.action), ['begin', 'complete']);
		assert.equal(paths.some((path) => path.includes('/capacity-provider-requests/request-1/approve')), true);
		assert.equal(paths.some((path) => path.endsWith('/reconcile')), true);
		assert.equal(JSON.parse(output[0]!).result.result.providerClosure.status, 'verified');
	} finally { await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept())); rmSync(root, { recursive: true, force: true }); }
});

test('provider enrollment defaults to the protected local manager socket contract', async () => {
	const requests: unknown[] = [];
	const result = await handoffProviderEnrollment({ action: 'complete', connectionId: 'local-team' }, {}, async (input) => {
		requests.push(input);
		return { connectionId: 'local-team', state: 'connected' };
	});
	assert.deepEqual(requests, [{ handlerId: 'local.host.provider.enrollment', arguments: [], options: { payload: '{"action":"complete","connectionId":"local-team"}' } }]);
	assert.deepEqual(result, { connectionId: 'local-team', state: 'connected' });
});

test('unavailable commands fail closed before network or filesystem mutation', async () => {
	const output: string[] = [];
	let invocations = 0;
	const exit = await runCommandLine(['release', '--yes', '--json'], { interactiveUi: false, operationInvoke: async () => { invocations += 1; }, write: (value) => output.push(value) });
	assert.equal(exit, 1);
	assert.equal(invocations, 0);
	assert.equal(JSON.parse(output[0]!).error.code, 'standards_migration_not_enabled');
});

test('high-risk operations replay the exact request with signed server confirmation', async () => {
	const requests: Array<{ idempotency: string | undefined; confirmation: string | undefined }> = [];
	const confirmation = { schemaVersion: 'treeseed.confirmation-state/v1', principalId: 'user_1', clientId: 'trsd', operationId: 'workdays.start', argumentsDigest: `sha256:${'a'.repeat(64)}`, expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'nonce', signature: 'signature' };
	const server = createServer((request, response) => {
		requests.push({ idempotency: request.headers['idempotency-key'] as string | undefined, confirmation: request.headers['x-treeseed-confirmation'] as string | undefined });
		response.setHeader('content-type', requests.length === 1 ? 'application/problem+json' : 'application/json');
		response.statusCode = requests.length === 1 ? 409 : 200;
		response.end(JSON.stringify(requests.length === 1
			? { type: 'about:blank', title: 'Confirmation required', status: 409, code: 'confirmation_required', inputRequired: { type: 'input_required', requestId: 'request_1', prompt: 'Confirm exact workday start.', confirmation } }
			: { data: { started: true } }));
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-confirmation-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		const profile = { serverId: 'test', label: 'Test', baseUrl: `http://127.0.0.1:${address.port}` };
		saveServerProfile(profile, env);
		saveServerSession({ serverId: 'test', audience: profile.baseUrl, accessToken: 'access-token' }, env);
		const output: string[] = [];
		const exit = await runCommandLine(['workdays', 'start', '--server', 'test', '--team', 'team-1', '--preflight', 'p1', '--digest', 'sha256:x', '--yes', '--json'], { env, interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 0);
		assert.deepEqual(JSON.parse(output[0]!).result, { started: true });
		assert.equal(requests.length, 2);
		assert.equal(requests[0]!.idempotency, requests[1]!.idempotency);
		assert.equal(requests[0]!.confirmation, undefined);
		assert.deepEqual(JSON.parse(Buffer.from(requests[1]!.confirmation!, 'base64url').toString('utf8')), confirmation);
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});

test('expired sessions rotate through OAuth before invoking the operation', async () => {
	const requests: Array<{ url: string; authorization: string | undefined; body: string }> = [];
	let baseUrl = '';
	const server = createServer((request, response) => {
		let body = '';
		request.on('data', (chunk) => { body += String(chunk); });
		request.on('end', () => {
			requests.push({ url: request.url ?? '', authorization: request.headers.authorization, body });
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(request.url === '/oauth/token'
				? { token_type: 'Bearer', access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 600, scope: 'treeseed:read', audience: baseUrl }
				: { data: { healthy: true } }));
		});
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	baseUrl = `http://127.0.0.1:${address.port}`;
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-refresh-'));
	const env = { TREESEED_CONFIG_HOME: root };
	try {
		saveServerProfile({ serverId: 'test', label: 'Test', baseUrl }, env);
		saveServerSession({ serverId: 'test', audience: baseUrl, accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: '2020-01-01T00:00:00.000Z' }, env);
		const output: string[] = [];
		const exit = await runCommandLine(['status', '--server', 'test', '--json'], { env, interactiveUi: false, write: (value) => output.push(value) });
		assert.equal(exit, 0);
		assert.deepEqual(JSON.parse(output[0]!).result, { healthy: true });
		assert.equal(requests[0]!.url, '/oauth/token');
		assert.match(requests[0]!.body, /grant_type=refresh_token/u);
		assert.equal(requests[1]!.authorization, 'Bearer new-access');
		assert.equal(loadServerSession('test', env)?.refreshToken, 'new-refresh');
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});

test('JSON device login keeps human approval instructions off stdout', async () => {
	let baseUrl = '';
	const server = createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify(request.url === '/oauth/device_authorization'
			? { device_code: 'device-a', user_code: 'ABCD-EFGH', verification_uri: `${baseUrl}/approve`,
				verification_uri_complete: `${baseUrl}/approve?user_code=ABCD-EFGH`, expires_in: 60, interval: 0 }
			: request.url === '/oauth/token' ? { token_type: 'Bearer', access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 600,
				scope: 'treeseed:read', audience: baseUrl }
				: { data: { principal: { id: 'user-a', displayName: 'Adrian Webb' }, teams: [] } }));
	});
	await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
	baseUrl = `http://127.0.0.1:${address.port}`;
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-device-'));
	const output: Array<{ value: string; stream?: string }> = [];
	const opened: string[] = [];
	try {
		saveServerProfile({ serverId: 'test', label: 'Test', baseUrl }, { TREESEED_CONFIG_HOME: root });
		const exit = await runCommandLine(['auth', 'login', '--server', 'test', '--json'], {
			env: { TREESEED_CONFIG_HOME: root }, interactiveUi: false,
			write: (value, stream) => output.push({ value, stream }),
			openExternal: async (url) => { opened.push(url); return true; },
		});
		assert.equal(exit, 0, JSON.stringify(output));
		assert.deepEqual(opened, [`${baseUrl}/approve?user_code=ABCD-EFGH`]);
		assert.match(output.filter(({ stream }) => stream === 'stderr').map(({ value }) => value).join('\n'), /Opened your default browser/u);
		assert.match(output.filter(({ stream }) => stream === 'stderr').map(({ value }) => value).join('\n'), /another computer.*ABCD-EFGH/u);
		const stdout = output.filter(({ stream }) => stream === 'stdout');
		assert.equal(stdout.length, 1);
		assert.equal(JSON.parse(stdout[0]!.value).ok, true);
		assert.equal(JSON.parse(stdout[0]!.value).result.principal.displayName, 'Adrian Webb');
	} finally {
		await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
		rmSync(root, { recursive: true, force: true });
	}
});
