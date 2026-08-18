import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	fetchCapacityWorkdayAssignments,
	isUnfinishedCapacityWorkdayAssignment,
	waitForCapacityWorkdayAssignments,
	type CapacityWorkdayAssignmentClient,
} from '../../../src/cli/handlers/capacity/workdays/execution/capacity-workday-assignment-poller.ts';

describe('capacity workday assignment polling', () => {
	it('uses the exact workday filter on every keyset page', async () => {
		const calls: Array<Record<string, unknown>> = [];
		const client: CapacityWorkdayAssignmentClient = {
			async capacityProviderAssignments(_teamId, options) {
				calls.push(options);
				return options.cursor
					? {
						payload: {
							items: [{ id: 'assignment-b', status: 'completed', metadata: { capacityWorkdayRunId: 'run-a' } }],
							page: { hasMore: false, nextCursor: null },
						},
					}
					: {
						payload: {
							items: [{ id: 'assignment-a', status: 'completed', metadata: { capacityWorkdayRunId: 'run-a' } }],
							page: { hasMore: true, nextCursor: 'cursor-a' },
						},
					};
			},
		};
		const result = await fetchCapacityWorkdayAssignments(client, 'team-a', [{
			projectId: 'project-a',
			workdayId: 'workday-a',
			assignmentIds: [],
		}], 'provider-a', 'run-a');
		assert.deepEqual(result.get('project-a')?.map((assignment) => assignment.id), ['assignment-a', 'assignment-b']);
		assert.equal(calls.length, 2);
		assert.ok(calls.every((call) => call.workdayId === 'workday-a'));
		assert.ok(calls.every((call) => call.view === 'lifecycle'));
		assert.deepEqual(calls.map((call) => call.cursor), [null, 'cursor-a']);
	});

	it('recognizes canonical workday demand provenance and waits for the first assignment to appear', async () => {
		let calls = 0;
		const client: CapacityWorkdayAssignmentClient = {
			async capacityProviderAssignments() {
				calls += 1;
				return {
					payload: {
						items: calls === 1 ? [] : [{
							id: 'assignment-a',
							status: 'completed',
							metadata: { workdayRunId: 'run-a' },
							synthesisKey: 'workday:run-a:project-a:cycle:1:agent:architect',
						}],
						page: { hasMore: false, nextCursor: null },
					},
				};
			},
		};
		const result = await waitForCapacityWorkdayAssignments(client, 'team-a', [{
			projectId: 'project-a',
			workdayId: 'workday-a',
			assignmentIds: [],
		}], 'provider-a', 2, 'run-a');
		assert.equal(result.completed, true);
		assert.equal(result.snapshots.get('project-a')?.length, 1);
		assert.ok(calls >= 2);
	});

	it('classifies only non-terminal assignments as unfinished', () => {
		assert.equal(isUnfinishedCapacityWorkdayAssignment({ status: 'leased' }), true);
		assert.equal(isUnfinishedCapacityWorkdayAssignment({ status: 'completed', leaseState: 'released' }), false);
		assert.equal(isUnfinishedCapacityWorkdayAssignment({ status: 'failed' }), false);
	});
});
