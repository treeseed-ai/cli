import type { CommandHandler } from '../../types.js';
import { guidedResult } from '../utilities/utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';

export const handleClose: CommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).close({
			message: invocation.positionals.join(' ').trim(),
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branchName: string;
			message: string;
			autoSaved?: boolean;
			repos: Array<{ deletedLocal: boolean; deletedRemote: boolean; skippedReason: string | null }>;
			rootRepo: { deletedLocal: boolean; deletedRemote: boolean; tagName: string | null };
			previewCleanup?: { performed: boolean };
			finalBranch?: string;
			worktreeCleanup?: { removed?: boolean };
			worktreePath?: string | null;
		};
		const deletedPackages = payload.repos.filter((repo) => repo.deletedLocal || repo.deletedRemote).length;
		return guidedResult({
			command: invocation.commandName || 'close',
			summary: result.executionMode === 'plan' ? 'Treeseed close plan ready.' : 'Treeseed close completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Closed branch', value: payload.branchName },
				{ label: 'Auto-saved', value: payload.autoSaved ? 'yes' : 'no' },
				{ label: 'Package branches cleaned', value: String(deletedPackages) },
				{ label: 'Preview cleanup', value: payload.previewCleanup?.performed ? 'performed' : result.executionMode === 'plan' ? 'planned' : 'not needed' },
				{ label: 'Worktree cleanup', value: payload.worktreeCleanup?.removed ? 'removed' : 'not needed' },
				{ label: 'Worktree path', value: payload.worktreePath ?? '(in-place)' },
				{ label: 'Final branch', value: payload.finalBranch ?? 'staging' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
