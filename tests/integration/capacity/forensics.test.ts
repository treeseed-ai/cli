import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	fetchExecutionRunsForAssignments,
	fetchProjectModeRunsForAssignment,
	fetchWorkdayAssignmentIdsForLog,
	type CapacityForensicsClient,
} from '../../../src/cli/handlers/capacity/observability/capacity-forensics.ts';

describe('capacity forensic reads', () => {
	it('preserves bounded assignment order and execution evidence', async () => {
		const paths: string[] = [];
		const client: CapacityForensicsClient = {
			async request<T>(path: string): Promise<T> {
				paths.push(path);
				if (path.includes('/assignments?')) return { ok: true, payload: { items: [
					{ id: 'assignment-b', workDayId: 'workday-a', assignedAt: '2026-07-17T12:01:00.000Z' },
					{ id: 'assignment-a', workDayId: 'workday-a', assignedAt: '2026-07-17T12:00:00.000Z' },
				] } } as T;
				return { ok: true, payload: { items: [{ id: path.includes('assignment-a') ? 'run-a' : 'run-b' }] } } as T;
			},
			async projectAgentModeRuns() {
				return { payload: { items: [
					{ id: 'phase-b', createdAt: '2026-07-17T12:01:00.000Z' },
					{ id: 'phase-a', createdAt: '2026-07-17T12:00:00.000Z' },
				] } };
			},
		};
		assert.deepEqual(await fetchWorkdayAssignmentIdsForLog(client, 'team-a', 'workday-a', null), ['assignment-a', 'assignment-b']);
		assert.deepEqual((await fetchExecutionRunsForAssignments(client, 'team-a', ['assignment-a', 'assignment-b'])).map((row) => row.id), ['run-a', 'run-b']);
		assert.deepEqual((await fetchProjectModeRunsForAssignment(client, 'project-a', 'assignment-a')).map((row) => row.id), ['phase-a', 'phase-b']);
		assert.ok(paths.every((path) => path.includes('limit=')));
	});

	it('propagates assignment, execution, and mode-run API failures', async () => {
		const failure = new Error('forensic API unavailable');
		const client: CapacityForensicsClient = {
			async request() { throw failure; },
			async projectAgentModeRuns() { throw failure; },
		};
		await assert.rejects(fetchWorkdayAssignmentIdsForLog(client, 'team-a', 'workday-a', null), failure);
		await assert.rejects(fetchExecutionRunsForAssignments(client, 'team-a', ['assignment-a']), failure);
		await assert.rejects(fetchProjectModeRunsForAssignment(client, 'project-a', 'assignment-a'), failure);
	});
});
