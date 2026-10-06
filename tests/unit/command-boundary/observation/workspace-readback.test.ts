import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { commandSpecs } from '../../../../src/cli/registry.ts';
import { saveServerSession } from '../../../../src/cli/support/server-custody.ts';

test('reads exact closed and open workspace resources and preserves denied unavailable and missing authority through native CLI', { timeout: 30_000 }, async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-workspace-read-'));
	const projectId = '22222222-2222-4222-8222-222222222222';
	const workspaceId = 'ws_terminalfixture';
	// Controlled HTTP resource inputs, not a real API/TreeDX server or physical closure receipt.
	const replies = [
		{ status: 200, body: { data: { result: { workspaceId, repoId: 'repository', status: 'closed' }, receipt: { projectId } } } },
		{ status: 200, body: { data: { result: { workspaceId, repoId: 'repository', status: 'open' }, receipt: { projectId } } } },
		...[[403, 'treedx_access_denied'], [503, 'treedx_workspace_verification_failed'], [404, 'not_found']].map(([status, code]) =>
			({ status: Number(status), body: { status, code, title: 'Isolated workspace authority denial.' } })),
	];
	const before = structuredClone(replies), requests: string[] = [];
	let selected = 0, child: ReturnType<typeof spawn> | undefined;
	const server = createServer((request, response) => {
		requests.push(`${request.method} ${request.url}`);
		response.writeHead(replies[selected]!.status, { 'content-type': 'application/json' });
		response.end(JSON.stringify(replies[selected]!.body));
	});
	try {
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const url = `http://127.0.0.1:${address.port}`;
		const env = { ...process.env, TREESEED_CONFIG_HOME: root, TREESEED_API_BASE_URL: url, TSX_DISABLE_CACHE: '1' };
		await saveServerSession({ identity: { issuer: 'https://isolated.example.test', subject: 'reader' }, clientId: 'trsd',
			scopes: ['treeseed:read'], serverId: 'local', audience: url, accessToken: 'isolated-fixture-token' }, env);
		const commands = commandSpecs.filter(value => value.execution.kind === 'operation' && value.execution.operationId === 'treedx.workspaces.show');
		assert.equal(commands.length, 1); assert.equal(commands[0]!.kind, 'read');
		const outcomes: Array<{ code: number | null; stdout: string; stderr: string }> = [];
		for (selected = 0; selected < replies.length; selected++) {
			child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...commands[0]!.path, workspaceId,
				'--server', 'local', '--project', projectId, '--json'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '', stderr = '';
			child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
			const code = await new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve); });
			outcomes.push({ code, stdout, stderr });
		}
		for (const [index, outcome] of outcomes.entries()) {
			const denied = index >= 2;
			assert.equal(outcome.code, denied ? 1 : 0, JSON.stringify(outcome));
			const envelope = JSON.parse(denied ? outcome.stderr : outcome.stdout) as { ok: boolean; result: unknown; error?: { code: string } };
			assert.equal(envelope.ok, !denied);
			if (denied) { assert.equal(envelope.result, null); assert.equal(envelope.error?.code, (replies[index]!.body as { code: string }).code); }
			else assert.deepEqual(envelope.result, (replies[index]!.body as { data: unknown }).data);
		}
		assert.deepEqual(requests, replies.map(() => `GET /v1/dx/projects/${projectId}/workspaces/${workspaceId}`));
		assert.deepEqual(replies, before);
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill(); await new Promise<void>(resolve => child!.once('close', () => resolve()));
		}
		server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
