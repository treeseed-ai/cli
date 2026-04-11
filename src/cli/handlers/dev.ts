import type { TreeseedCommandHandler } from '../types.js';
import { createWorkflowSdk, workflowErrorResult } from './workflow.js';

export const handleDev: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).dev({
			watch: invocation.commandName === 'dev:watch' || invocation.args.watch === true,
			background: false,
			stdio: 'inherit',
		});
		return {
			exitCode: result.ok ? 0 : 1,
			report: result.payload as Record<string, unknown>,
		};
	} catch (error) {
		return workflowErrorResult(error);
	}
};
