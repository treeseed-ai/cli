import { recoverTreeseedGitLocks } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

export const handleRecover: TreeseedCommandHandler = async (invocation, context) => {
	try {
		if (invocation.args.gitLocks === true || invocation.args['git-locks'] === true) {
			const execute = invocation.args.execute === true;
			const diagnostic = recoverTreeseedGitLocks(context.cwd, { execute, all: true });
			const repositories = 'repositories' in diagnostic ? diagnostic.repositories : [diagnostic];
			const blocked = repositories.some((entry) => entry.indexLockExists && !entry.safeToRepair);
			const present = repositories.filter((entry) => entry.indexLockExists);
			const removed = repositories.filter((entry) => entry.removed);
			return guidedResult({
				command: 'recover --git-locks',
				summary: present.length > 0
					? removed.length > 0
						? `Treeseed recover removed ${removed.length} safe stale Git index lock${removed.length === 1 ? '' : 's'}.`
						: blocked
							? `Treeseed recover found ${present.length} Git index lock${present.length === 1 ? '' : 's'}; at least one is not safe to remove automatically.`
							: `Treeseed recover found ${present.length} safe stale Git index lock${present.length === 1 ? '' : 's'}.`
					: 'Treeseed recover found no Git index locks.',
				facts: [
					{ label: 'Repositories checked', value: repositories.length },
					{ label: 'Locks present', value: present.length },
					{ label: 'Removed', value: removed.length },
					{ label: 'Blocked', value: blocked ? 'yes' : 'no' },
				],
				sections: [{
					title: 'Repositories',
					lines: repositories.map((entry) =>
						`${entry.repoRoot}: lock=${entry.indexLockExists ? 'yes' : 'no'} safe=${entry.safeToRepair ? 'yes' : 'no'} removed=${entry.removed ? 'yes' : 'no'} - ${entry.reason}`),
				}],
				nextSteps: present.length > 0 && present.every((entry) => entry.safeToRepair) && removed.length === 0
					? ['Run `trsd recover --git-locks --execute --json` to remove the stale lock.']
					: [],
				report: { diagnostic },
				exitCode: blocked ? 1 : 0,
			});
		}
		const result = await createWorkflowSdk(context).recover({
			pruneStale: invocation.args.pruneStale === true,
			obsoleteRunId: typeof invocation.args.obsolete === 'string' ? invocation.args.obsolete : undefined,
			obsoleteReason: typeof invocation.args.reason === 'string' ? invocation.args.reason : undefined,
		});
		const payload = result.payload as {
			lock: {
				active: boolean;
				stale: boolean;
				lock: {
					runId?: string | null;
					command?: string | null;
					updatedAt?: string | null;
				} | null;
			};
			interruptedRuns: Array<{
				runId: string;
				command: string;
			}>;
			staleRuns?: Array<{ runId: string; command: string }>;
			obsoleteRuns?: Array<{ runId: string; command: string }>;
			prunedRuns?: Array<{ runId: string; command: string }>;
			markedObsoleteRun?: { runId: string; command: string; reason: string } | null;
			runCount: number;
		};
		const markedObsolete = payload.markedObsoleteRun;
		return guidedResult({
			command: 'recover',
			summary: markedObsolete
				? `Treeseed recover marked ${markedObsolete.runId} obsolete.`
				: payload.interruptedRuns.length > 0 || payload.lock.active
				? 'Treeseed recover found workflow state that may need attention.'
				: 'Treeseed recover found no active locks or interrupted runs.',
			facts: [
				{ label: 'Active lock', value: payload.lock.active ? 'yes' : 'no' },
				{ label: 'Stale lock', value: payload.lock.stale ? 'yes' : 'no' },
				{ label: 'Interrupted runs', value: payload.interruptedRuns.length },
				{ label: 'Stale runs', value: payload.staleRuns?.length ?? 0 },
				{ label: 'Pruned runs', value: payload.prunedRuns?.length ?? 0 },
				{ label: 'Marked obsolete', value: markedObsolete?.runId ?? '(none)' },
				{ label: 'Recorded runs', value: payload.runCount },
			],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
