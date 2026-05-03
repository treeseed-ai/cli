import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleClose: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).close({
			message: invocation.positionals.join(' ').trim(),
			worktreeMode: typeof invocation.args.worktreeMode === 'string' ? invocation.args.worktreeMode as 'auto' | 'on' | 'off' : undefined,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branchName: string;
			message: string;
			autoSaved?: boolean;
			deprecatedTag?: { tagName: string };
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
				{ label: 'Deprecated tag', value: payload.rootRepo.tagName ?? payload.deprecatedTag?.tagName ?? '(planned)' },
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
