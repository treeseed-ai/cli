import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capacityWorkdayAgentClassId } from '../../../src/cli/handlers/capacity/workdays/configuration/capacity-workday-agent-class.ts';

describe('capacity workday project-agent-class identity', () => {
	it('scopes reusable configured class ids to their owning project', () => {
		assert.equal(capacityWorkdayAgentClassId('project-a', 'architecture'), 'project-a:architecture');
		assert.equal(capacityWorkdayAgentClassId('project-b', 'architecture'), 'project-b:architecture');
		assert.notEqual(capacityWorkdayAgentClassId('project-a', 'architecture'), capacityWorkdayAgentClassId('project-b', 'architecture'));
	});

	it('is stable when an already-scoped id is synchronized again', () => {
		assert.equal(capacityWorkdayAgentClassId('project-a', 'project-a:architecture'), 'project-a:architecture');
	});
});
