import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleSave: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).save({
			message: invocation.positionals.join(' ').trim(),
			hotfix: invocation.args.hotfix === true,
			preview: invocation.args.preview === true,
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode: 'root-only' | 'recursive-workspace';
			branch: string;
			scope: string;
			hotfix: boolean;
			message: string;
			commitSha: string;
			commitCreated: boolean;
			noChanges: boolean;
			repos?: Array<{
				name: string;
				commitSha?: string | null;
				committed?: boolean;
				pushed?: boolean;
				skippedReason?: string | null;
			}>;
			rootRepo?: {
				committed?: boolean;
				pushed?: boolean;
			};
			previewAction: { status: string };
		};
		const savedRepos = (payload.repos ?? [])
			.filter((repo) => repo.committed || repo.pushed)
			.map((repo) => `${repo.name}@${String(repo.commitSha ?? '').slice(0, 12)}`)
			.join(', ');
		return guidedResult({
			command: invocation.commandName || 'save',
			summary: result.executionMode === 'plan'
				? 'Treeseed save plan ready.'
				: payload.noChanges ? 'Treeseed save found no new changes and confirmed branch sync.' : 'Treeseed save completed successfully.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Branch', value: payload.branch },
				{ label: 'Environment scope', value: payload.scope },
				{ label: 'Hotfix', value: payload.hotfix ? 'yes' : 'no' },
				{ label: 'Commit', value: payload.commitSha.slice(0, 12) },
				{ label: 'Commit created', value: payload.commitCreated ? 'yes' : 'no' },
				{ label: 'Workspace repos', value: savedRepos || ((payload.repos ?? []).length > 0 ? 'none saved' : 'not applicable') },
				{ label: 'Market pushed', value: payload.rootRepo?.pushed ? 'yes' : 'no' },
				{ label: 'Preview action', value: payload.previewAction?.status ?? 'skipped' },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
