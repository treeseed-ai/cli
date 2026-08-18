import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followWorkdayActivity } from '../../../src/cli/handlers/capacity/workdays/observability/capacity-workday-follow.ts';

const event = {
	id: 'activity-a', sequence: 1, sourceEventId: 'source-a', timestamp: '2026-08-13T16:00:00.000Z',
	teamId: 'team-a', projectId: null, workdayId: 'workday-a', assignmentId: null, modeRunId: null,
	executionRunId: null, agentId: null, agentClassId: null, activityType: null, handlerId: null,
	capacityProviderId: null, providerManagerId: null, runnerId: null, executionProviderId: null,
	eventType: 'workday.completed', severity: 'info' as const, summary: 'Workday completed.',
	transcriptRef: null, artifactRefs: [], contextPackDigest: null, usageDelta: {}, durationMs: null,
	errorCategory: null, recoveryState: null, redactionStatus: 'sanitized', payloadDigest: 'digest-a',
};

describe('workday activity follow', () => {
	it('recovers from transient observation failures without duplicating JSONL events', async () => {
		let requests = 0;
		const writes: string[] = [];
		const client = { async request(path: string) {
			requests += 1;
			if (requests === 1) throw new TypeError('fetch failed');
			if (path.includes('/activity?')) return { payload: { items: requests === 2 ? [event] : [] } };
			return { payload: { run: { status: 'completed' } } };
		} };

		const result = await followWorkdayActivity({
			client, teamId: 'team-a', workdayId: 'workday-a', jsonl: true,
			agents: null, agentClasses: null, types: null, severity: null,
			pollIntervalMs: 1, maxTransientFailures: 2,
			context: { cwd: '.', env: {}, outputFormat: 'json', write: (value) => { writes.push(String(value)); }, spawn: async () => ({ exitCode: 0 }) },
		});

		assert.equal(result.after, 1);
		assert.equal(writes.length, 1);
		assert.equal(JSON.parse(writes[0]!).id, 'activity-a');
		assert.ok(requests >= 6);
	});

	it('does not retry authorization or contract failures', async () => {
		const failure = new Error('HTTP 401 unauthorized');
		await assert.rejects(followWorkdayActivity({
			client: { async request() { throw failure; } }, teamId: 'team-a', workdayId: 'workday-a', jsonl: false,
			agents: null, agentClasses: null, types: null, severity: null, pollIntervalMs: 1,
			context: { cwd: '.', env: {}, write: () => undefined, spawn: async () => ({ exitCode: 0 }) },
		}), failure);
	});
});
