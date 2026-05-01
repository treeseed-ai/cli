import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleStage: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).stage({
			message: invocation.positionals.join(' ').trim(),
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branchName: string;
			mergeTarget: string;
			mergeStrategy: string;
			autoSaved: boolean;
			deprecatedTag: { tagName: string };
			repos: Array<{ merged: boolean; deletedLocal: boolean; deletedRemote: boolean; skippedReason: string | null }>;
			rootRepo: { deletedLocal: boolean; deletedRemote: boolean; tagName: string | null };
			stagingWait: { status: string };
			previewCleanup: { performed: boolean };
			finalBranch: string;
		};
		const mergedPackages = payload.repos.filter((repo) => repo.merged).length;
		return guidedResult({
			command: invocation.commandName || 'stage',
			summary: result.executionMode === 'plan' ? 'Treeseed stage plan ready.' : 'Treeseed stage completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Merged branch', value: payload.branchName },
				{ label: 'Merge target', value: payload.mergeTarget },
				{ label: 'Merge strategy', value: payload.mergeStrategy },
				{ label: 'Auto-saved', value: payload.autoSaved ? 'yes' : 'no' },
				{ label: 'Deprecated tag', value: payload.rootRepo.tagName ?? payload.deprecatedTag.tagName },
				{ label: 'Package merges', value: String(mergedPackages) },
				{ label: 'Staging wait', value: payload.stagingWait.status },
				{ label: 'Preview cleanup', value: payload.previewCleanup.performed ? 'performed' : 'not needed' },
				{ label: 'Final branch', value: payload.finalBranch },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
