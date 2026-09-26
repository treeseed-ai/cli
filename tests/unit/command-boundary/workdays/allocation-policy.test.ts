import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

test('assignment explain preserves allocator evidence without inventing a CLI budget', async () => {
	const calls: Array<{ operationId: string; input: any }> = [];
	const output: string[] = [];
	const allocation = { allocatedSeconds: 60, limitingConstraint: 'task-duration',
		calibration: { multiplier: 2, measurementIds: [] }, opportunity: { shareSeconds: 600 } };
	const exit = await runCommandLine(['assignments', 'explain', 'assignment-1',
		'--team', '11111111-1111-4111-8111-111111111111', '--json'], {
		interactiveUi: false, write: (value) => output.push(value),
		operationInvoke: async (operationId, input) => {
			calls.push({ operationId, input }); return { data: { metadata: { allocation } } };
		},
	});
	assert.equal(exit, 0, output.join(''));
	assert.equal(calls[0]?.operationId, 'assignments.explain');
	assert.deepEqual(calls[0]?.input.path, { teamId: '11111111-1111-4111-8111-111111111111', assignmentId: 'assignment-1' });
	assert.deepEqual(JSON.parse(output.at(-1)!).result.metadata.allocation, allocation);
});

test('workday profile update sends a validated policy document under the API policy field', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-workday-policy-'));
	const file = resolve(root, 'policy.json');
	const policy = { durationSeconds: 28_800, maximumConcurrency: 1, communicationConcurrency: 1,
		planningPercent: 20, projectPercentages: { sdk: 100 }, agentClassPercentages: { sdk: { engineer: 100 } } };
	const calls: Array<{ operationId: string; input: any }> = [];
	const output: string[] = [];
	try {
		writeFileSync(file, JSON.stringify(policy));
		const exit = await runCommandLine(['workdays', 'profiles', 'update', 'default', '--team', '11111111-1111-4111-8111-111111111111', '--input', file,
			'--if-match', '1', '--yes', '--json'], { interactiveUi: false, write: value => output.push(value),
			operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: { id: 'default', teamId: '11111111-1111-4111-8111-111111111111', revision: 2, policy } }; } });
		assert.equal(exit, 0, output.join(''));
		assert.equal(calls[0]?.operationId, 'workdays.profiles.update');
		assert.deepEqual(calls[0]?.input.body.policy, { ...policy, allocationWeight: 1, planningTurnMaximumSeconds: 180 });
		assert.equal(calls[0]?.input.body.file, undefined);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('workday profile update rejects an invalid policy file before mutation', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-workday-policy-invalid-'));
	const file = resolve(root, 'policy.json');
	const calls: string[] = [];
	const output: string[] = [];
	try {
		writeFileSync(file, JSON.stringify({ durationSeconds: -1, maximumConcurrency: 1, communicationConcurrency: 1 }));
		const exit = await runCommandLine(['workdays', 'profiles', 'update', 'default', '--team', '11111111-1111-4111-8111-111111111111',
			'--input', file, '--if-match', '1', '--yes', '--json'], { interactiveUi: false, write: value => output.push(value),
			operationInvoke: async (operationId) => { calls.push(operationId); return { data: {} }; } });
		assert.equal(exit, 1);
		assert.deepEqual(calls, []);
		assert.equal(JSON.parse(output.at(-1)!).error.code, 'workday_policy_file_invalid');
	} finally { rmSync(root, { recursive: true, force: true }); }
});
