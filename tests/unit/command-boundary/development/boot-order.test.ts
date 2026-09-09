import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DevelopmentRuntime } from '@treeseed/sdk/development';
import { developmentBootOrder } from '../../../../src/cli/commands/development-support/boot-order.ts';

function runtime(id: string, target: string, dependencies: Array<[string, string]> = []) {
	return { project: { id }, targets: [{ id: target, dependencies: dependencies.map(([id, target]) => ({ id, target, reaction: 'none' })) }] } as DevelopmentRuntime;
}
const selections = [
	{ projectId: 'admin', targetId: 'web', mode: 'live' },
	{ projectId: 'api', targetId: 'service', mode: 'live' },
	{ projectId: 'deployment', targetId: 'package', mode: 'live' },
	{ projectId: 'sdk', targetId: 'package', mode: 'released' },
];
test('cold boot starts API before Admin and package dependencies before API', () => {
	const ordered = developmentBootOrder(selections, [runtime('admin', 'web', [['api', 'service']]), runtime('api', 'service', [['deployment', 'package'], ['sdk', 'package']]), runtime('deployment', 'package')]);
	assert.deepEqual(ordered.map(entry => entry.projectId), ['deployment', 'api', 'admin']);
	const ready = new Set<string>();
	for (const entry of ordered) {
		if (entry.projectId === 'admin') assert.ok(ready.has('api'));
		if (entry.projectId === 'api') assert.ok(ready.has('deployment'));
		ready.add(entry.projectId);
	}
});
test('cycles fail before startup and missing selected contracts fail closed', () => {
	assert.throws(() => developmentBootOrder(selections.slice(0, 2), [runtime('admin', 'web', [['api', 'service']]), runtime('api', 'service', [['admin', 'web']])]), /dependency cycle/);
	assert.throws(() => developmentBootOrder(selections, []), /runtime is missing/);
});
test('released and external dependencies do not create local processes', () => {
	assert.deepEqual(developmentBootOrder([selections[0]!, selections[3]!], [runtime('admin', 'web', [['sdk', 'package'], ['remote', 'service']])]), [selections[0]]);
});
