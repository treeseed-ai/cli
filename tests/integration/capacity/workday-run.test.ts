import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { compileCapacityWorkdayRequest } from '../../../src/cli/handlers/capacity/workdays/lifecycle/capacity-workday-run.ts';
import { exactWorkdayRunPath } from '../../../src/cli/handlers/capacity/capacity-core/capacity-market-inspection.ts';

describe('capacity workday run request', () => {
	it('uses the team-scoped exact run endpoint for forensic lookup', () => {
		assert.equal(
			exactWorkdayRunPath('team/a', 'run:a'),
			'/v1/teams/team%2Fa/workday-runs/run%3Aa',
		);
	});
	it('delegates a bounded multi-project planning run to the API scheduler', () => {
		const request = compileCapacityWorkdayRequest({
			id: 'editorial-planning-canary',
			providerId: 'provider-codex', projects: ['api', 'sdk', 'ui'], durationSeconds: 900,
			maxActiveAssignments: 3, planningOnly: true, purpose: 'plan shared contract',
			planningRounds: 1, assignmentTimeboxSeconds: 120,
			agentClasses: ['engineering'], agents: ['architect'], selectionMode: 'intersection',
			objectiveRefs: ['objective:harden-documentation-automation-workday-loop'],
		});
		assert.deepEqual({
			id: request.id,
			capacityProviderId: request.capacityProviderId,
			status: request.status,
			environment: request.environment,
			parameters: request.parameters,
		}, {
			id: 'editorial-planning-canary',
			capacityProviderId: 'provider-codex', status: 'running', environment: 'local',
			parameters: {
				purpose: 'plan shared contract', providerId: 'provider-codex',
				executionMode: 'simulation',
				projects: ['api', 'sdk', 'ui'], durationSeconds: 900, maxActiveAssignments: 3,
				planningOnly: true, planningSession: { rounds: 1, assignmentTimeboxSeconds: 120 }, agentSelection: { classIds: [], classSlugs: ['engineering'], agentSlugs: ['architect'], activityTypes: [], mode: 'intersection' },
				objectiveRefs: ['objective:harden-documentation-automation-workday-loop'],
			},
		});
		assert.equal('repositoryIdsBySlug' in request.parameters, false);
		assert.equal('resolvedAgentSelectionByProject' in request.parameters, false);
	});
});
