import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { CAPACITY_OPERATOR_CAPABILITIES } from '@treeseed/sdk/agent-capacity';
import { runCapacityCapabilityDiscovery } from '../../../src/cli/handlers/capacity/observability/capacity-capability-discovery.ts';

describe('capacity capability discovery',() => {
	it('returns the complete SDK registry without opening an API client',() => {
		const result = runCapacityCapabilityDiscovery({ args: {},positionals: ['capabilities'] } as any,{} as any) as any;
		assert.equal(result.report.schemaVersion,'treeseed.capacity-operator-capabilities/v1');
		assert.deepEqual(result.report.capabilities,CAPACITY_OPERATOR_CAPABILITIES);
		assert.deepEqual(result.report.assignmentTools.map((tool:any)=>tool.id).filter((id:string)=>id.startsWith('treeseed.assignment_')||id.startsWith('treeseed.discussion.')||id==='treeseed.operation.prepare_handoff'||id==='treeseed.client_session.request_action').sort(),[
			'treeseed.assignment_activity','treeseed.assignment_plan','treeseed.assignment_status_update','treeseed.assignment_summary','treeseed.discussion.follow','treeseed.discussion.read','treeseed.discussion.respond','treeseed.discussion.request_handoff','treeseed.discussion.create_artifact','treeseed.operation.prepare_handoff','treeseed.client_session.request_action',
		].sort());
	});
});
