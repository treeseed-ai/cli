import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleRelease: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const bump = (['major', 'minor', 'patch'] as const).find((candidate) => invocation.args[candidate] === true) ?? 'patch';
		const result = await createWorkflowSdk(context).release({ bump });
		const payload = result.payload as {
			level: string;
			rootVersion: string;
			releaseTag: string;
			releasedCommit: string;
			stagingBranch: string;
			productionBranch: string;
			touchedPackages: string[];
			finalBranch: string;
		};
		return guidedResult({
			command: invocation.commandName || 'release',
			summary: 'Treeseed release completed successfully.',
			facts: [
				{ label: 'Staging branch', value: payload.stagingBranch },
				{ label: 'Production branch', value: payload.productionBranch },
				{ label: 'Release level', value: payload.level },
				{ label: 'Root version', value: payload.rootVersion },
				{ label: 'Release tag', value: payload.releaseTag },
				{ label: 'Released commit', value: payload.releasedCommit.slice(0, 12) },
				{ label: 'Updated packages', value: payload.touchedPackages.length },
				{ label: 'Final branch', value: payload.finalBranch },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: payload,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
