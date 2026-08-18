import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { makeWorkspaceRoot } from '../../../support/cli-test-fixtures.ts';
import { runCli } from '../../../support/help-harness.ts';

describe('capacity plan lifecycle', () => {
	it('previews creation without mutation and executes every API-owned transition', async () => {
		const root = makeWorkspaceRoot();
		const previousFetch = globalThis.fetch;
		const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = async (input, init) => {
			const url = new URL(String(input));
			const method = init?.method ?? 'GET';
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
			calls.push({ path: url.pathname, method, body });
			return Response.json({ ok: true, payload: { id: url.pathname.includes('/decisions/') ? 'plan-created' : 'plan-a', status: url.pathname.split('/').at(-1) } }, { status: url.pathname.includes('/decisions/') ? 201 : 200 });
		};
		try {
			const planned = await runCli([
				'capacity', 'capacity-plan-create', '--market', 'local', '--decision', 'decision-a', '--project', 'project-a',
				'--execution-inputs', 'input-a,input-b,input-a', '--allocation', 'allocation-a', '--idempotency-key', 'plan-create-a', '--plan', '--json',
			], { cwd: root });
			assert.equal(planned.exitCode, 0, planned.stderr);
			assert.equal(calls.length, 0);
			assert.deepEqual(JSON.parse(planned.output).request, {
				projectId: 'project-a', decisionExecutionInputIds: ['input-a', 'input-b'], allocationSetId: 'allocation-a', idempotencyKey: 'plan-create-a',
			});

			const commands = [
				['capacity-plan-create', '--decision', 'decision-a', '--project', 'project-a'],
				['capacity-plan-accept', '--capacity-plan', 'plan-a'],
				['capacity-plan-request-revision', '--capacity-plan', 'plan-a', '--reason', 'Revise estimates'],
				['capacity-plan-schedule', '--capacity-plan', 'plan-a', '--workday', 'workday-a'],
				['capacity-plan-supersede', '--capacity-plan', 'plan-a', '--reason', 'Replaced'],
			];
			for (const [index, command] of commands.entries()) {
				const result = await runCli(['capacity', ...command, '--market', 'local', '--idempotency-key', `mutation-${index}`, '--execute', '--json'], { cwd: root });
				assert.equal(result.exitCode, 0, result.stderr);
				assert.equal(JSON.parse(result.output).idempotencyKey, `mutation-${index}`);
			}
			assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
				'POST /v1/decisions/decision-a/capacity-plans',
				'POST /v1/capacity-plans/plan-a/accept',
				'POST /v1/capacity-plans/plan-a/request-revision',
				'POST /v1/capacity-plans/plan-a/schedule',
				'POST /v1/capacity-plans/plan-a/supersede',
			]);
			assert.deepEqual(calls.map((call) => call.body.idempotencyKey), ['mutation-0', 'mutation-1', 'mutation-2', 'mutation-3', 'mutation-4']);
			assert.equal(calls[2]?.body.reason, 'Revise estimates');
			assert.equal(calls[3]?.body.workDayId, 'workday-a');
		} finally {
			globalThis.fetch = previousFetch;
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('requires evidence and explicit confirmation for binding simulated-human transitions', async () => {
		const root = makeWorkspaceRoot();
		try {
			const missingEvidence = await runCli([
				'capacity', 'capacity-plan-accept', '--market', 'local', '--capacity-plan', 'plan-a', '--simulate-human', '--execute', '--json',
			], { cwd: root });
			assert.equal(missingEvidence.exitCode, 1);
			assert.match(missingEvidence.stderr, /requires --workday and --reason/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
