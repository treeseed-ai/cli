import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleUpdate: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).update({
			from: typeof invocation.args.from === 'string' ? invocation.args.from : undefined,
			strategy: typeof invocation.args.strategy === 'string' ? invocation.args.strategy as 'merge' | 'ff-only' : undefined,
			push: invocation.args.noPush === true ? false : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true,
		});
		const payload = result.payload as {
			mode: string;
			branch: string;
			sourceBranch: string;
			strategy: string;
			rootRepo?: { action?: string };
			repos?: Array<{ action?: string }>;
			pushed?: boolean;
			worktreePath?: string | null;
			conflicts?: unknown[];
		};
		const repos = payload.repos ?? [];
		const updated = repos.filter((repo) => repo.action === 'merged' || repo.action === 'fast-forwarded' || repo.action === 'pushed').length;
		const unchanged = repos.filter((repo) => repo.action === 'up-to-date').length;
		return guidedResult({
			command: invocation.commandName || 'update',
			summary: result.executionMode === 'plan'
				? `Update plan from ${payload.sourceBranch} into ${payload.branch}.`
				: `Updated ${payload.branch} from ${payload.sourceBranch}.`,
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Current branch', value: payload.branch },
				{ label: 'Source branch', value: payload.sourceBranch },
				{ label: 'Strategy', value: payload.strategy },
				{ label: 'Root action', value: payload.rootRepo?.action ?? 'unknown' },
				{ label: 'Package repos updated', value: String(updated) },
				{ label: 'Package repos unchanged', value: String(unchanged) },
				{ label: 'Pushed', value: payload.pushed ? 'yes' : 'no' },
				{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
				{ label: 'Conflicts', value: String(payload.conflicts?.length ?? 0) },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
