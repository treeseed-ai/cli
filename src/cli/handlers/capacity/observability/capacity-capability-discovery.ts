import { CAPACITY_OPERATOR_CAPABILITIES } from '@treeseed/sdk/agent-capacity';
import { AGENT_TOOL_DEFINITIONS } from '@treeseed/sdk/agent-tools';
import type { CommandContext,ParsedInvocation } from '../../../types.js';
import { guidedResult } from '../../utilities/utils.js';

export const CAPACITY_DISCOVERY_ACTIONS = new Set(['capabilities']);

export function runCapacityCapabilityDiscovery(_invocation: ParsedInvocation,_context: CommandContext) {
	const assignmentTools=AGENT_TOOL_DEFINITIONS.filter((tool)=>tool.executionTarget==='provider_runner').map((tool)=>({ id:tool.id,mutability:tool.mutability,requirements:tool.requirements,inputSchema:tool.inputSchema,outputSchema:tool.outputSchema }));
	return guidedResult({
		command: 'capacity capabilities',
		summary: `Discovered ${CAPACITY_OPERATOR_CAPABILITIES.length} canonical capacity operations.`,
		facts: [{ label: 'Registry',value: 'SDK-owned' },{ label: 'Operations',value: CAPACITY_OPERATOR_CAPABILITIES.length },{ label:'Assignment tools',value:assignmentTools.length }],
		sections: [{ title: 'Boundary',lines: ['Read-only operator and agent discovery; mutation authority remains API-owned.'] }],
		report: { schemaVersion: 'treeseed.capacity-operator-capabilities/v1',capabilities: CAPACITY_OPERATOR_CAPABILITIES,assignmentTools },
	});
}
