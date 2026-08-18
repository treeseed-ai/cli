import type { CommandHandler } from '../../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';

export const handleTasks: CommandHandler = async (invocation, context) => {
	try {
		const cleanupMerged = typeof invocation.args.cleanupMerged === 'string'
			? invocation.args.cleanupMerged as 'plan' | 'live'
			: undefined;
		const result = await createWorkflowSdk(context).tasks({ cleanupMerged });
		const tasks = result.payload.tasks;
		const branchCleanup = result.payload.branchCleanup as Array<{
			repository: string;
			branches: Array<{ branch: string; status: 'planned' | 'deleted' | 'preserved'; reason: string }>;
		}> | undefined;
		const cleanupFacts = branchCleanup?.flatMap((repo) => repo.branches.map((branch) => ({
			label: `${repo.repository}:${branch.branch}`,
			value: `${branch.status} (${branch.reason})`,
		}))) ?? [];
		return guidedResult({
			command: 'tasks',
			summary: cleanupMerged
				? result.summary ?? 'Merged remote task branch cleanup completed.'
				: tasks.length === 0 ? 'No Treeseed task branches found.' : `Found ${tasks.length} Treeseed task branch${tasks.length === 1 ? '' : 'es'}.`,
			facts: cleanupMerged ? cleanupFacts : tasks.map((task) => ({
				label: task.current ? `* ${task.name}` : task.name,
				value: [
					task.head.slice(0, 12),
					task.local ? 'local' : null,
					task.remote ? 'remote' : null,
					task.dirtyCurrent ? 'dirty' : null,
					task.preview.enabled ? `preview:${task.preview.url ?? 'enabled'}` : 'preview:none',
				].filter(Boolean).join(' '),
			})),
			nextSteps: renderWorkflowNextSteps(result),
			report: {
				...result,
				tasks,
				branchCleanup,
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
