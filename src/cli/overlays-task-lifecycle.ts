import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const taskLifecycleCommandOverlays: Array<[string, CommandOverlay]> = [
	['status', command({
			options: [
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
				{ name: 'live', flags: '--live', description: 'Run read-only provider connectivity checks and include the results in status.', kind: 'boolean' },
				{ name: 'history', flags: '--history <mode>', description: 'Control obsolete workflow history detail in status output.', kind: 'enum', values: ['recent', 'all'] },
			],
			examples: ['treeseed status', 'treeseed status --json', 'treeseed status --live', 'treeseed status --history all --json'],
			help: {
				workflowPosition: 'inspect',
				longSummary: [
					'Status is the fastest orientation command in the Treeseed workflow. It tells you where you are, what branch role you are on, and whether the current workspace is in a state where other workflow commands make sense.',
					'Use it as the first command when you enter a project or return to a task after some time away.',
				],
				whenToUse: [
					'Use this before `switch`, `save`, `stage`, or `release` when you need to confirm the current branch role and workspace state.',
					'Use it when debugging workflow confusion and you need the CLI to summarize the current project health quickly.',
				],
				beforeYouRun: [
					'Run from the workspace you want to inspect.',
					'Use `--live` only when you want read-only provider connectivity checks in addition to saved state.',
					'Choose `--json` when another tool or agent needs to read the status programmatically.',
				],
				outcomes: [
					'Prints the current branch role, project health, and related state without mutating the workspace.',
					'Gives you the orientation you need before choosing the next workflow command.',
				],
				examples: [
					example('treeseed status', 'Check the current task state', 'Show the current branch role and project health in human-readable form.'),
					example('treeseed status --json', 'Feed an agent or script', 'Emit structured status data for automation and external tooling.'),
					example('treeseed status --live', 'Check provider connectivity', 'Include read-only GitHub, Cloudflare, and Railway identity checks in the status report.'),
					example('treeseed status --history all --json', 'Inspect full workflow history', 'Include every obsolete workflow run instead of the default recent cap.'),
					example('trsd status', 'Use the short alias', 'Run the same status inspection path through the shorter CLI entrypoint.'),
				],
				automationNotes: [
					'`--json` is the preferred mode for automation because it preserves branch-role and health information in structured form.',
					'This command is safe to call repeatedly because it is read-only.',
				],
				relatedDetails: [
					related('tasks', 'Move to `tasks` when status tells you there are multiple task branches and you need the list.'),
					related('switch', 'Move to `switch` when status shows you are not on the task branch you want to resume.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'status',
		})],
	['tasks', command({
			options: [
				{ name: 'cleanupMerged', flags: '--cleanup-merged <mode>', description: 'Plan or execute deletion of exact remote task heads already merged into staging or main.', kind: 'enum', values: ['plan', 'live'] },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed tasks', 'treeseed tasks --json', 'treeseed tasks --cleanup-merged plan', 'treeseed tasks --cleanup-merged live'],
			help: {
				workflowPosition: 'inspect',
				longSummary: [
					'Tasks lists the current task branches and related preview metadata so you can see what active work exists before choosing a branch to resume or close.',
				],
				whenToUse: [
					'Use this when you know there are multiple task branches and you need a quick inventory.',
					'Use it before `switch` if you want to confirm the exact branch name to resume.',
				],
				outcomes: [
					'Prints the task inventory and any surfaced preview metadata without changing the repo state.',
					'With `--cleanup-merged plan`, reports exact remote task heads that are safely merged into staging or main.',
					'With `--cleanup-merged live`, deletes only those exact merged remote heads and preserves active or unmerged work.',
				],
				examples: [
					example('treeseed tasks', 'List task branches', 'Show active task branches in the current workspace.'),
					example('treeseed tasks --json', 'Machine-readable task inventory', 'Emit the task list in JSON for scripts or agent tooling.'),
					example('treeseed tasks --cleanup-merged plan', 'Plan stale branch cleanup', 'Inspect every managed repository without changing remote refs.'),
					example('treeseed tasks --cleanup-merged live', 'Clean merged remote branches', 'Delete exact remote task heads already contained by staging or main.'),
					example('trsd tasks', 'Use the short alias', 'Run the same task listing flow through the shorter CLI entrypoint.'),
				],
				relatedDetails: [
					related('status', 'Use `status` when you want one branch summary instead of the full task inventory.'),
					related('switch', 'Use `switch` after identifying the task branch you want to enter or resume.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'tasks',
		})],
	['switch', command({
			arguments: [{ name: 'branch-name', description: 'Task branch to create or resume.', required: true }],
			options: [
				{ name: 'preview', flags: '--preview', description: 'Provision or refresh a branch-scoped Cloudflare preview environment.', kind: 'boolean' },
				{ name: 'worktree', flags: '--worktree', description: 'Open or resume the task in a managed workflow worktree.', kind: 'boolean' },
				{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
				{ name: 'adoptChanges', flags: '--adopt-changes', description: 'Move dirty staging work into a new task branch without stashing or rewriting files.', kind: 'boolean' },
				{ name: 'plan', flags: '--plan', description: 'Compute the recursive branch switch plan without mutating any repo.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed switch feature/search-improvements', 'treeseed switch feature/search-improvements --preview', 'treeseed switch feature/search-improvements --plan'],
			help: {
				workflowPosition: 'start work',
				longSummary: [
					'Switch is the entry point into task work. It creates or resumes a task branch, aligns the workspace to that branch, and optionally provisions the branch preview when you want environment feedback immediately.',
					'This is the command to use when the next thing you want is a task-shaped working branch with Treeseed semantics around branch role and preview handling.',
				],
				whenToUse: [
					'Use this when starting a new task or resuming an existing task branch.',
					'Use `--preview` when you need branch-scoped environment feedback as part of the task lifecycle.',
				],
				beforeYouRun: [
					'Run from the target Treeseed workspace.',
					'Choose a branch name that reflects the task and fits the repo branch naming conventions.',
					'If you request `--preview`, make sure the project has the necessary provider configuration for branch previews.',
				],
				outcomes: [
					'Creates or checks out the requested task branch.',
					'Optionally provisions or refreshes the branch preview environment.',
					'Sets up the branch state expected by later commands such as `save`, `close`, and `stage`.',
				],
				examples: [
					example('treeseed switch feature/search-improvements', 'Resume or create a task branch', 'Enter the task branch for a feature or work item.'),
					example('treeseed switch feature/search-improvements --preview', 'Attach preview provisioning', 'Create or refresh the branch preview while switching into the task.'),
					example('treeseed switch bugfix/auth-header --json', 'Automate branch entry', 'Emit structured output so another tool can react to the branch state and preview metadata.', { why: 'Useful for scripted workflow orchestration.' }),
				],
				optionDetails: [
					detail('--preview', 'Use this when the task should immediately have a branch-scoped preview deployment or refresh.'),
					detail('--json', 'Prefer this when another tool needs the branch and preview result in structured form.'),
				],
				warnings: [
					'`switch` is the task-lifecycle entrypoint. Do not use it as a generic git checkout replacement for arbitrary non-task branches.',
				],
				relatedDetails: [
					related('status', 'Use `status` first if you are unsure what branch role you are on before switching.'),
					related('save', 'Use `save` after making meaningful progress on the task branch.'),
					related('close', 'Use `close` when the task should be abandoned or superseded instead of merged.'),
					related('stage', 'Use `stage` when the task is ready to merge into staging.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'switch',
		})],
	['save', command({
			arguments: [{ name: 'message', description: 'Optional hint for generated save commit messages.', required: false, kind: 'message_tail' }],
			options: [
				{ name: 'hotfix', flags: '--hotfix', description: 'Allow save on main for an explicit hotfix.', kind: 'boolean' },
				{ name: 'preview', flags: '--preview', description: 'Create or refresh the branch preview during save.', kind: 'boolean' },
				{ name: 'verifyMode', flags: '--verify <mode>', description: 'Run package-local verification before pushing.', kind: 'enum', values: ['fast', 'local', 'skip'] },
				{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
				{ name: 'plan', flags: '--plan', description: 'Compute the recursive save plan without mutating any repo.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed save', 'treeseed save "add search filters"', 'treeseed save --preview', 'treeseed save --verify local', 'treeseed save --plan', 'treeseed save --hotfix "fix production form submit"'],
			help: {
				workflowPosition: 'checkpoint work',
				longSummary: [
					'Save is the main task-branch checkpoint command. It verifies, commits, syncs, pushes, and can refresh the task preview so the branch remains in a clean, reviewable state.',
					'Use it instead of ad hoc manual git-and-preview sequences when you want the standard Treeseed task-save behavior.',
					'Save is deliberately limited to a fast repository checkpoint. It never waits for hosted deployment or runs release guarantees.',
				],
				whenToUse: [
					'Use this after a meaningful unit of work on a task branch.',
					'Use the default fast lane for routine code, docs, and low-risk package checkpoints where package pointers and lockfile validation are enough.',
					'Use `--verify local` when a fast-lane checkpoint should also run package-local verification before pushing.',
					'Use `--preview` when the branch preview should be refreshed as part of the save operation.',
					'Use `--hotfix` only when you are intentionally saving from `main` for an explicit production hotfix flow.',
				],
				beforeYouRun: [
					'Run from a task branch unless you intentionally mean to use the hotfix path.',
					'Optionally provide a short hint; Treeseed generates the final commit message from the diff and hint.',
				],
				outcomes: [
					'Verifies and commits current work using a generated commit message.',
					'Syncs and pushes branch state.',
					'Saves dependency-ordered repositories without hosted CI, deploy waits, package installation, or guarantee execution.',
					'Optionally refreshes preview infrastructure if requested.',
				],
				examples: [
					example('treeseed save', 'Fast checkpoint', 'Commit and push the current task branch through the default fast lane.'),
					example('treeseed save "add search filters"', 'Checkpoint with a hint', 'Feed a short hint into commit-message generation without replacing the generated message.'),
					example('treeseed save --verify local "add search filters"', 'Fast checkpoint with local verification', 'Keep hosted waits off while running package-local verification before pushing.'),
					example('treeseed save --preview', 'Checkpoint plus preview refresh', 'Include preview refresh when the save should update the branch environment.'),
					example('treeseed save --hotfix "fix production form submit"', 'Explicit hotfix save', 'Allow a save from main when the work is a deliberate hotfix path.', { why: 'Use sparingly and only when the workflow intentionally bypasses the usual task-branch rule.' }),
				],
				warnings: [
					'Use `stage` for hosted candidate proof and `release` for production promotion.',
					'`--verify local` can still be expensive because package-local verify scripts may run builds, unit tests, and smoke tests even though hosted gates remain off.',
					'`--hotfix` deliberately loosens the normal task-branch safety model. Keep it exceptional.',
				],
				relatedDetails: [
					related('switch', 'Use `switch` to enter the task branch before saving work.'),
					related('stage', 'Use `stage` when the saved task is ready to merge to staging.'),
					related('close', 'Use `close` when the task should be archived instead of staged.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'save',
		})],
	['update', command({
			options: [
				{ name: 'from', flags: '--from <branch>', description: 'Source branch to merge from.', kind: 'string' },
				{ name: 'strategy', flags: '--strategy <mode>', description: 'Merge strategy.', kind: 'enum', values: ['merge', 'ff-only'] },
				{ name: 'noPush', flags: '--no-push', description: 'Do not push branches after a successful update.', kind: 'boolean' },
				{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
				{ name: 'plan', flags: '--plan', description: 'Compute the update plan without mutating any repo.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed update --from staging', 'treeseed update --from staging --plan --json', 'treeseed update --from staging --strategy ff-only --plan'],
			help: {
				workflowPosition: 'sync task branch',
				longSummary: [
					'Update merges staging, or another selected source branch, down into the current task branch across market and checked-out package repositories.',
					'It is the inverse of stage: update brings staging into the task branch, while stage promotes the task branch back into staging.',
				],
				whenToUse: [
					'Use this from a task branch or managed worktree when staging has advanced and the task needs the latest integrated state.',
					'Use --plan before a risky update to see which repositories need a merge.',
				],
				beforeYouRun: [
					'Run from the task branch or managed worktree you want to update.',
					'The root and package repositories must be clean. Run `treeseed save` first if there are local changes.',
				],
				outcomes: [
					'Merges the selected source branch into checked-out package repos first, then the root market repo.',
					'Commits updated root package pointers when package heads changed.',
					'Pushes updated branches by default unless --no-push is supplied.',
				],
				examples: [
					example('treeseed update --from staging --json', 'Update from staging', 'Merge origin/staging into the current task branch and push the result.'),
					example('treeseed update --from staging --plan --json', 'Plan the update', 'Inspect package and root merge needs without changing any repository.'),
					example('treeseed update --from staging --strategy ff-only --plan', 'Require fast-forward', 'Check whether the task branch can be updated without a merge commit.'),
				],
				relatedDetails: [
					related('status', 'Use `status` before update when you need to confirm the current branch role and cleanliness.'),
					related('save', 'Use `save` before update when local changes need to be checkpointed.'),
					related('stage', 'Use `stage` after update when the task is ready to promote back into staging.'),
					related('switch', 'Use `switch` to create or resume the task branch before updating it.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'update',
		})],
	['close', command({
			arguments: [{ name: 'message', description: 'Reason for closing the task without staging it.', required: true, kind: 'message_tail' }],
			options: [
				{ name: 'plan', flags: '--plan', description: 'Compute the recursive close plan without mutating any repo.', kind: 'boolean' },
				{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed close "superseded by feature/search-v2"', 'treeseed close --plan "superseded by feature/search-v2"'],
			notes: ['Auto-saves meaningful uncommitted task-branch changes before cleanup unless disabled in the workflow API.'],
			help: {
				workflowPosition: 'abandon task',
				longSummary: [
					'Close archives a task branch without merging it. It is the workflow path for superseded, abandoned, or no-longer-needed task work.',
				],
				whenToUse: [
					'Use this when a task branch should be cleaned up rather than merged.',
					'Use it when the work moved elsewhere or the task turned out to be unnecessary.',
				],
				outcomes: [
					'Archives the task branch workflow state.',
					'Auto-saves meaningful uncommitted task work before cleanup unless disabled deeper in the workflow layer.',
				],
				examples: [
					example('treeseed close "superseded by feature/search-v2"', 'Archive superseded work', 'Close a task branch that is no longer the active line of work.'),
					example('treeseed close "duplicate of feature/new-auth"', 'Close a duplicate task', 'Record the reason a task was abandoned so later auditing remains understandable.'),
					example('treeseed close --json "no longer needed"', 'Automate task cleanup', 'Emit structured workflow results while closing the task branch.'),
				],
				warnings: [
					'Closing does not merge the task. Use `stage` instead when the work should move forward into staging.',
				],
				relatedDetails: [
					related('save', 'Use `save` if the task should remain active and you only need a checkpoint.'),
					related('stage', 'Use `stage` if the branch is complete and should be merged into staging.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'close',
		})],
];
