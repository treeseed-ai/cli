import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCapacityWorkdaySummaryOptions } from '../../../src/cli/handlers/capacity/workdays/lifecycle/capacity-workday.ts';

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
		for (const limit of [0, 201, 1.5, 'many']) {
			assert.match(parseCapacityWorkdaySummaryOptions({ evidence: 'assignments', limit }).error ?? '', /integer from 1 through 200/u);
		}
	});
});
