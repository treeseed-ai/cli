import assert from 'node:assert/strict';
import test from 'node:test';
import { commandSpecs } from '../../../../src/cli/registry.ts';
import { parseInvocation } from '../../../../src/cli/parser.ts';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

test('requires one generated read command for exact workday events with cursor and page limit', () => {
	const commands = commandSpecs.filter(command => command.execution.kind === 'operation'
		&& command.execution.operationId === 'workdays.events.list');
	assert.equal(commands.length, 1, 'Existing event operation is inaccessible to the supported CLI');
	assert.equal(commands[0]!.kind, 'read');
	assert.ok(commands[0]!.options.some(option => option.flag === '--cursor'));
	assert.ok(commands[0]!.options.some(option => option.flag === '--limit'));
	assert.ok(commands[0]!.options.some(option => option.flag === '--team'));
});

test('binds optional workday diagnostic detail to the sole generated read operation without deriving execution authority', async () => {
	const held = structuredClone(commandSpecs), commands = commandSpecs.filter(command => command.execution.kind === 'operation'
		&& command.execution.operationId === 'workdays.events.list');
	assert.equal(commands.length, 1); const command = commands[0]!;
	assert.equal(command.kind, 'read'); assert.equal(command.confirmation, 'never');
	assert.deepEqual(command.options.filter(option => option.flag === '--diagnostics'), [
		{ name: 'diagnostics', flag: '--diagnostics', kind: 'string', description: 'Diagnostic detail: metadata or full.' },
	]);
	assert.equal(command.execution.kind, 'operation');
	if (command.execution.kind !== 'operation') throw new Error('Original workday event operation is required.');
	assert.deepEqual(command.execution.input.filter(binding => binding.field === 'diagnostics'), [
		{ target: 'query', field: 'diagnostics', source: 'option', name: 'diagnostics', required: false, transform: 'identity' },
	]);
	for (const next of command.options) assert.throws(() => parseInvocation(command, ['workday-fixture', '--diagnostics', next.flag]), /Missing value for --diagnostics/u);
	assert.equal(parseInvocation(command, ['workday-fixture', '--diagnostics=--json']).options.diagnostics, '--json');
	assert.equal(parseInvocation(command, ['workday-fixture', '--cursor', '-literal']).options.cursor, '-literal');
	const teamId = '11111111-1111-4111-8111-111111111111', runId = 'workday-fixture';
	for (const detail of [undefined, 'metadata', 'full']) {
		const argv = [...command.path, runId, '--team', teamId, '--limit', '50', '--cursor', 'exact-cursor',
			...(detail === undefined ? [] : ['--diagnostics', detail]), '--json'];
		const before = structuredClone(argv), calls: unknown[] = [], output: string[] = [];
		assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => output.push(value),
			operationInvoke: async (id, input) => { calls.push({ id, input }); return { data: { observed: true } }; } }), 0);
		assert.deepEqual(calls, [{ id: 'workdays.events.list', input: { path: { teamId, runId },
			query: { limit: 50, cursor: 'exact-cursor', ...(detail === undefined ? {} : { diagnostics: detail }) }, body: undefined } }]);
		assert.equal(output.length, 1); const envelope = JSON.parse(output[0]!);
		assert.equal(envelope.ok, true); assert.deepEqual(envelope.result, { observed: true }); assert.deepEqual(envelope.warnings, []);
		assert.deepEqual(argv, before);
	}
	const argv = [...command.path, runId, '--team', teamId, '--diagnostics', '--json'], before = structuredClone(argv), errors: string[] = [];
	let invoked = 0;
	assert.equal(await runCommandLine(argv, { interactiveUi: false, write: value => errors.push(value),
		operationInvoke: async () => { invoked++; } }), 1);
	assert.equal(invoked, 0); assert.equal(errors.length, 1); const error = JSON.parse(errors[0]!);
	assert.equal(error.ok, false); assert.equal(error.result, null); assert.equal(error.error.category, 'invalid_input');
	assert.deepEqual(error.warnings, []); assert.deepEqual(argv, before); assert.deepEqual(commandSpecs, held);
});
