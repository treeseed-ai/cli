import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';
import { getOperationInputField, setOperationInputField } from '../../../../src/cli/support/operations/input-fields.ts';

const base = ['workdays', 'plan', '--team', '11111111-1111-4111-8111-111111111111', '--profile', 'documentation', '--projects', 'sdk', '--start', '2030-01-01T00:00:00Z', '--duration', '600', '--json'];

test('repeated and CSV selectors become a normalized intersecting nested intent', async () => {
	const calls: Array<{ operationId: string; input: any }> = [];
	const exit = await runCommandLine([...base, '--agent', 'reviewer,architect', '--agent', 'reviewer', '--activity', 'reviewing', '--class', 'engineering'], {
		interactiveUi: false, write() {}, operationInvoke: async (operationId, input) => { calls.push({ operationId, input }); return { data: {} }; },
	});
	assert.equal(exit, 0); assert.equal(calls.length, 1); assert.equal(calls[0]!.operationId, 'workdays.plan');
	assert.deepEqual(calls[0]!.input.body.agentSelection, { classIds: [], classSlugs: ['engineering'], agentSlugs: ['architect', 'reviewer'], activityTypes: ['reviewing'], mode: 'intersection' });
	assert.equal(Object.keys(calls[0]!.input.body).some(key => key.includes('.')), false);
});

test('omitted selection leaves the full intent unchanged', async () => {
	let body: any;
	assert.equal(await runCommandLine(base, { interactiveUi: false, write() {}, operationInvoke: async (_id, input) => { body = input.body; return { data: {} }; } }), 0);
	assert.equal(Object.hasOwn(body, 'agentSelection'), false);
});

for (const selector of [['--agent', ''], ['--agent', 'reviewer,'], ['--activity', 'acting'], ['--activity', 'reviewng']]) {
	test(`invalid selection ${JSON.stringify(selector)} never invokes the API`, async () => {
		let calls = 0; const output: string[] = [];
		assert.equal(await runCommandLine([...base, ...selector], { interactiveUi: false, write: value => output.push(value), operationInvoke: async () => { calls++; } }), 1);
		assert.equal(calls, 0);
		const error = JSON.parse(output[0]!).error;
		assert.equal(error.category, 'invalid_input');
		assert.equal(error.code, selector[1] === '' ? 'invalid_input' : 'workday_agent_selection_invalid');
	});
}

test('nested bindings reject prototype traversal, collisions, and excessive depth', () => {
	const input = {}; setOperationInputField(input, 'agentSelection.agentSlugs', ['reviewer']);
	assert.deepEqual(getOperationInputField(input, 'agentSelection.agentSlugs'), ['reviewer']);
	assert.equal(getOperationInputField(input, 'missing.value'), undefined);
	for (const path of ['__proto__.polluted', 'constructor.prototype', 'x..y', 'a.b.c.d.e.f.g.h.i']) assert.throws(() => setOperationInputField(input, path, true), /Unsafe/u);
	assert.throws(() => setOperationInputField(input, 'agentSelection.agentSlugs', []), /Duplicate/u);
	assert.throws(() => setOperationInputField(input, 'agentSelection.agentSlugs.x', true), /Conflicting/u);
	assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});
