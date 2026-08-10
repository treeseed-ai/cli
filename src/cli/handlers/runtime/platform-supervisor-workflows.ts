import { inspectWorkflowLock, type WorkflowLockScope } from '@treeseed/sdk/workflow-support';
import type { PlatformSupervisorState } from './platform-supervisor-state.js';

export type PlatformWorkflowBlocker = {
	scope: WorkflowLockScope;
	runId: string;
	command: string;
};

type InspectWorkflow = (root: string, options: { scope: WorkflowLockScope }) => {
	active: boolean;
	lock: { runId: string; command: string } | null;
};

export function activePlatformWorkflow(root: string, inspect: InspectWorkflow = inspectWorkflowLock): PlatformWorkflowBlocker | null {
	for (const scope of ['worktree', 'shared'] as const) {
		const inspection = inspect(root, { scope });
		if (inspection.active && inspection.lock) {
			return { scope, runId: inspection.lock.runId, command: inspection.lock.command };
		}
	}
	return null;
}

export async function runPlatformMutationWhenAvailable(
	root: string,
	state: PlatformSupervisorState,
	mutation: () => Promise<void>,
	inspect: InspectWorkflow = inspectWorkflowLock,
) {
	const blocker = activePlatformWorkflow(root, inspect);
	if (blocker) {
		state.lastDeferredAt = new Date().toISOString();
		state.deferredByWorkflow = blocker;
		return false;
	}
	state.deferredByWorkflow = undefined;
	await mutation();
	return true;
}
