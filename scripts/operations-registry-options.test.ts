import assert from 'node:assert/strict';
import test from 'node:test';
import { TRESEED_OPERATION_SPECS } from '../src/cli/operations-registry.ts';

test('every command exposes one canonical meaning per option name and long flag', () => {
	for (const operation of TRESEED_OPERATION_SPECS) {
		const names = new Set<string>();
		const longFlags = new Set<string>();
		for (const option of operation.options ?? []) {
			assert.equal(names.has(option.name), false, `${operation.name} duplicates option name ${option.name}`);
			names.add(option.name);
			for (const flag of option.flags.match(/--[a-z0-9-]+/giu) ?? []) {
				assert.equal(longFlags.has(flag), false, `${operation.name} duplicates long option flag ${flag}`);
				longFlags.add(flag);
			}
		}
	}
});

test('capacity exposes bounded pagination without removed native-limit migration flags', () => {
	const capacity = TRESEED_OPERATION_SPECS.find((operation) => operation.name === 'capacity');
	assert.ok(capacity);
	const flags = (capacity.options ?? []).map((option) => option.flags);
	assert.equal(flags.filter((flag) => flag.startsWith('--limit ')).length, 1);
	assert.equal(flags.filter((flag) => flag.startsWith('--evidence ')).length, 1);
	assert.equal(flags.filter((flag) => flag.startsWith('--reservation ')).length, 1);
	assert.equal(flags.filter((flag) => flag === '--yes').length, 1);
	const evidence = capacity.options?.find((option) => option.name === 'evidence');
	assert.deepEqual(evidence?.values, ['assignments', 'mode-runs', 'reservations', 'usage-actuals', 'ledger-entries']);
	for (const removed of ['--native-unit', '--reset-cadence', '--quota-visibility', '--reserve-buffer-percent', '--max-concurrent-workers', '--portfolio-allocation-percent']) {
		assert.equal(flags.some((flag) => flag.startsWith(removed)), false, `capacity still exposes unused ${removed}`);
	}
});
