import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	fetchExecutionRunsForAssignments,
	fetchProjectModeRunsForAssignment,
	fetchWorkdayAssignmentIdsForLog,
	type CapacityForensicsClient,
} from '../../../src/cli/handlers/capacity/observability/capacity-forensics.ts';
import { readCompleteTranscript } from '../../../src/cli/handlers/capacity/workdays/observability/capacity-workday-inspection.ts';

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
		assert.ok(paths.filter((path) => path.includes('/execution-runs')).every((path) => path.includes('projection=activity')));
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

	it('accepts a coordinated workday run id as the workday-log selector', async () => {
		const paths: string[] = [];
		const client: CapacityForensicsClient = {
			async request<T>(path: string): Promise<T> {
				paths.push(path);
				if (paths.length === 1) return { ok: true, payload: { items: [] } } as T;
				return { ok: true, payload: { items: [{
					id: 'assignment-run',
					workDayId: 'workday-envelope',
					metadata: { workdayRunId: 'run-a' },
					assignedAt: '2026-08-02T10:00:00.000Z',
				}] } } as T;
			},
		};
		assert.deepEqual(await fetchWorkdayAssignmentIdsForLog(client, 'team-a', 'run-a', null), ['assignment-run']);
		assert.equal(paths.length, 2);
		assert.match(paths[0]!, /workdayId=run-a/u);
		assert.doesNotMatch(paths[1]!, /workdayId=/u);
	});

	it('retrieves every forensic transcript page in durable cursor order', async () => {
		const paths: string[] = [];
		const client = {
			async request<T>(path: string): Promise<T> {
				paths.push(path);
				return (paths.length === 1
					? { payload: { executionRunId: 'execution-a', redactionStatus: 'sanitized', entries: [{ sequence: 1 }], page: { limit: 200, hasMore: true, nextCursor: 'cursor-1' } } }
					: { payload: { executionRunId: 'execution-a', redactionStatus: 'sanitized', entries: [{ sequence: 2 }], page: { limit: 200, hasMore: false, nextCursor: null } } }) as T;
			},
		};

		const transcript = await readCompleteTranscript(client, 'execution-a');
		assert.deepEqual(transcript.entries, [{ sequence: 1 }, { sequence: 2 }]);
		assert.deepEqual(transcript.page, { limit: 2, hasMore: false, nextCursor: null });
		assert.match(paths[0]!, /limit=200/u);
		assert.match(paths[1]!, /cursor=cursor-1/u);
	});
});
