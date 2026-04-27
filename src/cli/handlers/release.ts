import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleRelease: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const bump = (['major', 'minor', 'patch'] as const).find((candidate) => invocation.args[candidate] === true) ?? 'patch';
		const result = await createWorkflowSdk(context).release({
			bump,
			workspaceLinks: typeof invocation.args.workspaceLinks === 'string' ? invocation.args.workspaceLinks as 'auto' | 'off' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			mergeStrategy: string;
			level: string;
			rootVersion: string;
			releaseTag: string;
			releasedCommit: string;
			stagingBranch: string;
			productionBranch: string;
			touchedPackages: string[];
			packageSelection: { changed: string[]; dependents: string[]; selected: string[] };
			publishWait: Array<{ name: string; status: string; conclusion?: string | null }>;
			finalBranch: string;
		};
		const completedPublishes = payload.publishWait.filter((entry) => entry.status === 'completed').length;
		return guidedResult({
			command: invocation.commandName || 'release',
			summary: result.executionMode === 'plan' ? 'Treeseed release plan ready.' : 'Treeseed release completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Staging branch', value: payload.stagingBranch },
				{ label: 'Production branch', value: payload.productionBranch },
				{ label: 'Merge strategy', value: payload.mergeStrategy },
				{ label: 'Release level', value: payload.level },
				{ label: 'Root version', value: payload.rootVersion },
				{ label: 'Release tag', value: payload.releaseTag },
				{ label: 'Released commit', value: payload.releasedCommit.slice(0, 12) },
				{ label: 'Changed packages', value: String(payload.packageSelection.changed.length) },
				{ label: 'Dependent packages', value: String(payload.packageSelection.dependents.length) },
				{ label: 'Released packages', value: String(payload.touchedPackages.length) },
				{ label: 'Publish waits', value: String(completedPublishes) },
				{ label: 'Final branch', value: payload.finalBranch },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
