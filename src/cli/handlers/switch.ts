import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleSwitch: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const branch = invocation.positionals[0];
		const result = await createWorkflowSdk(context).switchTask({
			branch,
			preview: invocation.args.preview === true,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branchName: string;
			created: boolean;
			resumed: boolean;
			repos: Array<{ created: boolean; resumed: boolean }>;
			rootRepo: { created: boolean; resumed: boolean };
			preview: { enabled: boolean; url: string | null };
		};
		const packageCreated = payload.repos.filter((repo) => repo.created).length;
		const packageResumed = payload.repos.filter((repo) => repo.resumed).length;
		return guidedResult({
			command: invocation.commandName || 'switch',
			summary: result.executionMode === 'plan'
				? `Switch plan for ${payload.branchName}.`
				: payload.rootRepo.created
					? `Created task branch ${payload.branchName}.`
					: payload.rootRepo.resumed
						? `Switched to task branch ${payload.branchName}.`
						: `Task branch ${payload.branchName} is ready.`,
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Branch', value: payload.branchName },
				{ label: 'Market created', value: payload.rootRepo.created ? 'yes' : 'no' },
				{ label: 'Package branches created', value: String(packageCreated) },
				{ label: 'Package branches resumed', value: String(packageResumed) },
				{ label: 'Preview', value: payload.preview.enabled ? 'enabled' : 'disabled' },
				{ label: 'Preview URL', value: payload.preview.url ?? '(none)' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
