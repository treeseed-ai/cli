import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { makeWorkspaceRoot } from '../../../support/cli-test-fixtures.ts';
import { runCli } from '../../../support/help-harness.ts';

describe('capacity workday admission fence', () => {
	it('previews without mutation and executes the API-owned idempotent fence', async () => {
		const root = makeWorkspaceRoot();
		const previousFetch = globalThis.fetch;
		const calls: Array<{ path: string; method: string }> = [];
		globalThis.fetch = async (input, init) => {
			const url = new URL(String(input));
			const method = init?.method ?? 'GET';
			calls.push({ path: url.pathname, method });
			if (url.pathname === '/v1/teams/by-name/treeseed/profile') {
				return Response.json({ ok: true, payload: { team: { id: 'team-a' }, activity: { projects: [] } } });
			}
			if (url.pathname === '/v1/teams/team-a/workday-runs/run-a/close-admission' && method === 'POST') {
				return Response.json({ ok: true, payload: { admissionClosed: true, assignments: { total: 2, terminal: 2, failed: 0 } } });
			}
			return Response.json({ ok: false, error: 'Unexpected request' }, { status: 404 });
		};
		try {
			const planned = await runCli(['capacity', 'workday-close-admission', '--market', 'local', '--team', 'treeseed', '--workday', 'run-a', '--plan', '--json'], { cwd: root });
			assert.equal(planned.exitCode, 0, planned.stderr);
			assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

			const executed = await runCli(['capacity', 'workday-close-admission', '--market', 'local', '--team', 'treeseed', '--workday', 'run-a', '--execute', '--json'], { cwd: root });
			assert.equal(executed.exitCode, 0, executed.stderr);
			assert.equal(JSON.parse(executed.output).payload.admissionClosed, true);
			assert.equal(calls.filter((call) => call.path.endsWith('/close-admission') && call.method === 'POST').length, 1);
		} finally {
			globalThis.fetch = previousFetch;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
