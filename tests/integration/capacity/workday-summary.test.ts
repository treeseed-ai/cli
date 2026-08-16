import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileWorkdayRunCancellation, parseCapacityWorkdaySummaryOptions } from '../../../src/cli/handlers/capacity/workdays/lifecycle/capacity-workday.ts';

describe('capacity workday summary options', () => {
	it('passes one explicit bounded evidence continuation to the API client', () => {
		assert.deepEqual(parseCapacityWorkdaySummaryOptions({
			evidence: 'assignments',
			limit: '25',
			cursor: 'opaque-cursor',
		}), {
			options: { evidence: 'assignments', limit: 25, cursor: 'opaque-cursor' },
		});
	});

	it('rejects invalid evidence, unscoped cursors, and invalid limits', () => {
		assert.match(parseCapacityWorkdaySummaryOptions({ evidence: 'unknown' }).error ?? '', /Invalid --evidence/u);
		assert.match(parseCapacityWorkdaySummaryOptions({ cursor: 'opaque-cursor' }).error ?? '', /requires --evidence/u);
		assert.match(parseCapacityWorkdaySummaryOptions({ limit: 25 }).error ?? '', /requires --evidence/u);
		for (const limit of [0, 201, 1.5, 'many']) {
			assert.match(parseCapacityWorkdaySummaryOptions({ evidence: 'assignments', limit }).error ?? '', /integer from 1 through 200/u);
		}
	});
});

describe('capacity parent workday cancellation', () => {
	it('targets the API-owned portfolio run and preserves an operator reason', () => {
		assert.deepEqual(compileWorkdayRunCancellation({
			teamId: 'team-1',
			workdayRunId: 'run-1',
			reason: '  Stop the bounded observer test.  ',
		}), {
			teamId: 'team-1',
			workdayRunId: 'run-1',
			status: 'cancelled',
			reason: 'Stop the bounded observer test.',
		});
	});

	it('omits an empty reason rather than sending ambiguous whitespace', () => {
		assert.deepEqual(compileWorkdayRunCancellation({ teamId: 'team-1', workdayRunId: 'run-1', reason: '  ' }), {
			teamId: 'team-1',
			workdayRunId: 'run-1',
			status: 'cancelled',
		});
	});
});
