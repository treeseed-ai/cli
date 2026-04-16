import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleTasks: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).tasks();
		const tasks = result.payload.tasks;
		return guidedResult({
			command: 'tasks',
			summary: tasks.length === 0 ? 'No Treeseed task branches found.' : `Found ${tasks.length} Treeseed task branch${tasks.length === 1 ? '' : 'es'}.`,
			facts: tasks.map((task) => ({
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
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
