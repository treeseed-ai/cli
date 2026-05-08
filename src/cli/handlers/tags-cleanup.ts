import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

function parseIncludePackages(value: unknown) {
	if (typeof value !== 'string' || value.trim().length === 0) return undefined;
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export const handleTagsCleanup: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).tagsCleanup({
			includePackages: parseIncludePackages(invocation.args.includePackages),
			branchScope: typeof invocation.args.branchScope === 'string' ? invocation.args.branchScope as 'staging' | 'preview' | 'all' : undefined,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			status?: string;
			branchScope?: string;
			includePackages?: string[];
			repos?: Array<{ name?: string; candidateCount?: number; cleanedCount?: number; skippedCount?: number }>;
			candidateCount?: number;
			cleanedCount?: number;
			skippedCount?: number;
		};
		return guidedResult({
			command: invocation.commandName || 'tags:cleanup',
			summary: result.executionMode === 'plan' ? 'Treeseed dev tag cleanup plan ready.' : 'Treeseed dev tag cleanup completed.',
			facts: [
				{ label: 'Status', value: payload.status ?? (result.executionMode === 'plan' ? 'planned' : 'completed') },
				{ label: 'Branch scope', value: payload.branchScope ?? 'all' },
				{ label: 'Included packages', value: (payload.includePackages ?? []).join(', ') || 'all' },
				{ label: 'Candidate tags', value: String(payload.candidateCount ?? 0) },
				{ label: 'Cleaned tags', value: String(payload.cleanedCount ?? 0) },
				{ label: 'Skipped tags', value: String(payload.skippedCount ?? 0) },
			],
			sections: [
				{
					title: 'Repositories',
					lines: (payload.repos ?? []).map((repo) =>
						`- ${repo.name ?? 'repo'}: candidates ${repo.candidateCount ?? 0}, cleaned ${repo.cleanedCount ?? 0}, skipped ${repo.skippedCount ?? 0}`),
				},
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
