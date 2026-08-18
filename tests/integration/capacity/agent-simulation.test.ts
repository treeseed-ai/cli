import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { makeWorkspaceRoot } from '../../support/cli-test-fixtures.ts';
import { runCli } from '../../support/help-harness.ts';

const draft = {
	projectId: 'project-1', projectName: 'Market', expectedBase: 'b'.repeat(40), diagnostics: [],
	seedPath: 'seeds/agent-lab-treeseed.yaml', seedYaml: 'name: agent-lab-treeseed\n',
	scenePath: 'scenes/agent-lab/treeseed-browser-demo.yaml', sceneYaml: 'schemaVersion: treeseed.scene/v1\n',
	testPath: 'src/content/agent-tests/agent-lab-project-inventory.mdx', testMdx: '---\nagent: guide-writer\n---\n',
};

describe('capacity agent simulation', () => {
	it('plans without mutation and executes through TreeDX publication before immutable launch', async () => {
		const root = makeWorkspaceRoot();
		const previousFetch = globalThis.fetch;
		const calls: Array<{ url: string; method: string; body: unknown }> = [];
		globalThis.fetch = async (input, init) => {
			const url = String(input); const method = init?.method ?? 'GET';
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
			calls.push({ url, method, body });
			if (url.includes('/v1/teams/by-name/treeseed/profile')) return Response.json({ ok: true, payload: { team: { id: 'team-1', name: 'Treeseed' }, activity: { projects: [] } } });
			if (url.includes('/surfaces/build/draft')) return Response.json({ ok: true, payload: draft });
			if (url.endsWith('/surfaces/build/authoring-bundle')) return Response.json({ ok: true, payload: { commit: 'c'.repeat(40), branch: 'staging', changedPaths: [draft.seedPath, draft.scenePath, draft.testPath], changeset: {} } });
			if (url.endsWith('/agent-lab/simulations')) return Response.json({ ok: true, payload: { id: 'operation-1', status: 'queued', scenePath: draft.scenePath, immutableRef: 'c'.repeat(40) } }, { status: 202 });
			return Response.json({ ok: false, error: `Unexpected request ${method} ${url}` }, { status: 404 });
		};
		try {
			const planned = await runCli(['capacity', 'agent-simulation-run', '--market', 'local', '--team', 'treeseed', '--project', 'project-1', '--agents', 'architect', '--activity-profiles', 'planning', '--duration-seconds', '180', '--planning-rounds', '1', '--assignment-timebox-seconds', '60', '--max-active-assignments', '1', '--plan', '--json'], { cwd: root });
			assert.equal(planned.exitCode, 0, planned.stderr);
			assert.equal(JSON.parse(planned.output).mode, 'plan');
			assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
			const draftUrl = new URL(calls.find((call) => call.url.includes('/surfaces/build/draft'))?.url ?? 'http://invalid');
			assert.equal(draftUrl.searchParams.get('agents'), 'architect');
			assert.equal(draftUrl.searchParams.get('activityProfiles'), 'planning');
			assert.equal(draftUrl.searchParams.get('durationSeconds'), '180');
			assert.equal(draftUrl.searchParams.get('planningRounds'), '1');
			assert.equal(draftUrl.searchParams.get('assignmentTimeboxSeconds'), '60');
			assert.equal(draftUrl.searchParams.get('maxActiveAssignments'), '1');

			calls.length = 0;
			const executed = await runCli(['capacity', 'agent-simulation-run', '--market', 'local', '--team', 'treeseed', '--project', 'project-1', '--idempotency-key', 'cli:test:simulation', '--execute', '--json'], { cwd: root });
			assert.equal(executed.exitCode, 0, executed.stderr);
			const report = JSON.parse(executed.output);
			assert.equal(report.simulation.id, 'operation-1');
			const executedDraftUrl = new URL(calls.find((call) => call.url.includes('/surfaces/build/draft'))?.url ?? 'http://invalid');
			assert.equal(executedDraftUrl.searchParams.get('assignmentTimeboxSeconds'), '600');
			const writes = calls.filter((call) => call.method === 'POST');
			assert.equal(writes.length, 2);
			assert.equal((writes[0]?.body as Record<string, unknown>).expectedBase, draft.expectedBase);
			assert.equal((writes[1]?.body as Record<string, unknown>).immutableRef, 'c'.repeat(40));
			assert.equal((writes[1]?.body as Record<string, unknown>).requestId, 'cli:test:simulation');
		} finally {
			globalThis.fetch = previousFetch;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
