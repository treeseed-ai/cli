import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleClose: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).close({
			message: invocation.positionals.join(' ').trim(),
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branchName: string;
			message: string;
			autoSaved: boolean;
			deprecatedTag: { tagName: string };
			repos: Array<{ deletedLocal: boolean; deletedRemote: boolean; skippedReason: string | null }>;
			rootRepo: { deletedLocal: boolean; deletedRemote: boolean; tagName: string | null };
			previewCleanup: { performed: boolean };
			finalBranch: string;
		};
		const deletedPackages = payload.repos.filter((repo) => repo.deletedLocal || repo.deletedRemote).length;
		return guidedResult({
			command: invocation.commandName || 'close',
			summary: result.executionMode === 'plan' ? 'Treeseed close plan ready.' : 'Treeseed close completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Closed branch', value: payload.branchName },
				{ label: 'Auto-saved', value: payload.autoSaved ? 'yes' : 'no' },
				{ label: 'Deprecated tag', value: payload.rootRepo.tagName ?? payload.deprecatedTag.tagName },
				{ label: 'Package branches cleaned', value: String(deletedPackages) },
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
