import type { CommandHandler } from '../../../types.js';
import { runCapacityWorkdayRun } from '../workdays/lifecycle/capacity-workday-run.js';
import { CAPACITY_MARKET_INSPECTION_ACTIONS } from './capacity-market-inspection.js';
import { CAPACITY_DISCOVERY_ACTIONS } from '../observability/capacity-capability-discovery.js';
import { PROVIDER_ENTRYPOINT_ACTIONS,PROVIDER_LIFECYCLE_ACTIONS } from './capacity-runtime.js';
import { routeCapacityAction } from './routing/capacity-action-router.js';

export { PROVIDER_ENTRYPOINT_ACTIONS,PROVIDER_LIFECYCLE_ACTIONS } from './capacity-runtime.js';
export const MARKET_INSPECTION_ACTIONS = new Set([...CAPACITY_MARKET_INSPECTION_ACTIONS,...CAPACITY_DISCOVERY_ACTIONS, 'execution-runs', 'workday-log', 'workday-run']);

export const handleCapacity: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'doctor';
	return routeCapacityAction(action, invocation, context, runCapacityWorkdayRun);
};
