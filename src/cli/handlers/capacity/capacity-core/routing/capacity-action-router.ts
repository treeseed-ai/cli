import type { CommandContext, ParsedInvocation } from '../../../../types.js';
import { fail } from '../../../utilities/utils.js';
import { CAPACITY_GOVERNANCE_ACTIONS, runCapacityGovernanceAction } from '../capacity-governance.js';
import { CAPACITY_PROVIDER_GOVERNANCE_ACTIONS, runCapacityProviderGovernanceAction } from '../../providers/capacity-provider-governance.js';
import { CAPACITY_WORKDAY_ACTIONS, runCapacityWorkdayAction } from '../../workdays/lifecycle/capacity-workday.js';
import { CAPACITY_WORKDAY_SCHEDULE_ACTIONS, runCapacityWorkdayScheduleAction } from '../../workdays/lifecycle/capacity-workday-schedules.js';
import { CAPACITY_ASSIGNMENT_ACTIONS, runCapacityAssignmentAction } from '../../assignments/capacity-assignments.js';
import { CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS, runCapacityCheckpointIntegration } from '../capacity-checkpoint-integration.js';
import { CAPACITY_OVERRUN_ACTIONS, runCapacityOverrunAction } from '../../accounting/capacity-overruns.js';
import { CAPACITY_EVIDENCE_ACTIONS, runCapacityEvidenceAction } from '../../observability/capacity-evidence.js';
import { CAPACITY_AGENT_CLASS_ACTIONS, runCapacityAgentClassAction } from '../../agents/capacity-agent-classes.js';
import { PROVIDER_ENTRYPOINT_ACTIONS, PROVIDER_LIFECYCLE_ACTIONS, runCapacityLifecycleAction, runCapacityProviderEntrypoint } from '../capacity-runtime.js';
import { CAPACITY_MARKET_INSPECTION_ACTIONS, runCapacityMarketInspection } from '../capacity-market-inspection.js';
import { runCapacityDiagnostics } from '../../observability/capacity-diagnostics.js';
import { runExecutionRunsInspection } from '../../workdays/observability/capacity-workday-inspection.js';

type WorkdayRunner = (invocation: ParsedInvocation, context: CommandContext) => Promise<any>;

async function safely(action: () => Promise<any> | any) {
	try { return await action(); }
	catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
}

export async function routeCapacityAction(
	action: string,
	invocation: ParsedInvocation,
	context: CommandContext,
	runWorkday: WorkdayRunner,
) {
	if (CAPACITY_PROVIDER_GOVERNANCE_ACTIONS.has(action)) return safely(() => runCapacityProviderGovernanceAction(action, invocation, context));
	if (CAPACITY_GOVERNANCE_ACTIONS.has(action)) return safely(() => runCapacityGovernanceAction(action, invocation, context));
	if (CAPACITY_WORKDAY_ACTIONS.has(action)) return safely(() => runCapacityWorkdayAction(action, invocation, context));
	if (CAPACITY_WORKDAY_SCHEDULE_ACTIONS.has(action)) return safely(() => runCapacityWorkdayScheduleAction(action, invocation, context));
	if (CAPACITY_ASSIGNMENT_ACTIONS.has(action)) return safely(() => runCapacityAssignmentAction(action, invocation, context));
	if (CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS.has(action)) return safely(() => runCapacityCheckpointIntegration(invocation, context));
	if (CAPACITY_OVERRUN_ACTIONS.has(action)) return safely(() => runCapacityOverrunAction(action, invocation, context));
	if (CAPACITY_EVIDENCE_ACTIONS.has(action)) return safely(() => runCapacityEvidenceAction(action, invocation, context));
	if (CAPACITY_AGENT_CLASS_ACTIONS.has(action)) return safely(() => runCapacityAgentClassAction(action, invocation, context));
	if (action === 'diagnostics') return safely(() => runCapacityDiagnostics(invocation, context));
	if (action === 'workday-run') return safely(() => runWorkday(invocation, context));
	if (action === 'execution-runs' || action === 'workday-log') {
		return safely(() => runExecutionRunsInspection(invocation, context, action === 'workday-log' ? { action: 'workday-log' } : {}));
	}
	if (CAPACITY_MARKET_INSPECTION_ACTIONS.has(action)) return safely(() => runCapacityMarketInspection(action, invocation, context));
	if (PROVIDER_LIFECYCLE_ACTIONS.has(action)) return safely(() => runCapacityLifecycleAction(action, invocation, context));
	if (PROVIDER_ENTRYPOINT_ACTIONS.has(action)) return safely(() => runCapacityProviderEntrypoint(action, invocation, context));
	return fail(`Unknown capacity action "${action}". Use registration-key operations, provider request/membership operations, grants, allocation operations, workday-create, workday-start, workday-pause, workday-resume, workday-tick, workday-complete, workday-cancel, workday-status, workday-summary, assignment-cancel, assignment-requeue, checkpoint-integrate, overrun-approve, overrun-reject, provider runtime lifecycle, or inspection actions.`);
}
