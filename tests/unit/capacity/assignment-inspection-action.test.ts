import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAPACITY_EVIDENCE_ACTIONS } from '../../../src/cli/handlers/capacity/observability/capacity-evidence.ts';
import { CAPACITY_MARKET_INSPECTION_ACTIONS } from '../../../src/cli/handlers/capacity/capacity-core/capacity-market-inspection.ts';

describe('capacity assignment inspection action', () => {
	it('exposes the singular exact-assignment action required by agent guarantee proofs', () => {
		assert.equal(CAPACITY_EVIDENCE_ACTIONS.has('assignment'), true);
		assert.equal(CAPACITY_MARKET_INSPECTION_ACTIONS.has('assignments'), true);
	});
});
