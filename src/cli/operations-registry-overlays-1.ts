import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const CLI_COMMAND_OVERLAYS_1: Array<[string, CommandOverlay]> = [
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
	['ci', command({
		options: [
			{ name: 'failed', flags: '--failed', description: 'Focus human output on failures and attention-needed workflows.', kind: 'boolean' },
			{ name: 'logs', flags: '--logs', description: 'Fetch capped log excerpts for failed jobs.', kind: 'boolean' },
			{ name: 'logLines', flags: '--log-lines <n>', description: 'Maximum failed-job log lines to include with --logs.', kind: 'string' },
			{ name: 'scope', flags: '--scope <scope>', description: 'Select workspace, root, or package repositories.', kind: 'enum', values: ['workspace', 'root', 'packages'] },
			{ name: 'workflow', flags: '--workflow <file>', description: 'Inspect a specific workflow file. May be repeated.', kind: 'string', repeatable: true },
			{ name: 'branch', flags: '--branch <name>', description: 'Inspect this branch name in all selected repositories.', kind: 'string' },
			{ name: 'strict', flags: '--strict', description: 'Return nonzero for pending workflows as well as failures.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed ci', 'treeseed ci --failed', 'treeseed ci --logs --log-lines 50', 'treeseed ci --scope packages --workflow verify.yml --json'],
		help: {
			workflowPosition: 'inspect',
			longSummary: [
				'CI inspects the remote GitHub Actions runs for the current branch heads in market and checked-out package repositories.',
				'It is read-only and is designed for quickly finding failed hosted verification without digging through GitHub UI pages.',
			],
			whenToUse: [
				'Use this after `save`, `stage`, or a pushed package change when you need the latest remote verification state.',
				'Use `--failed` when you only want attention items, or `--logs` when you want failed-job excerpts inline.',
			],
			beforeYouRun: [
				'Run from the Treeseed workspace you want to inspect.',
				'Make sure the branch heads you care about have been pushed; unpushed heads are reported as not pushed.',
				'Use `--json` for agent or script consumption.',
			],
			outcomes: [
				'Lists passing, pending, missing, not-pushed, and failing GitHub Actions workflows.',
				'Shows failed jobs, failed steps when GitHub provides them, workflow URLs, and inspect commands.',
			],
			examples: [
				example('treeseed ci', 'Inspect workspace CI', 'Check market and checked-out package workflows for the active branch heads.'),
				example('treeseed ci --failed', 'Focus on failures', 'Show only failed and attention-needed workflows in human output.'),
				example('treeseed ci --logs --log-lines 50', 'Include failed logs', 'Fetch compact failed-job log excerpts while keeping output bounded.'),
				example('treeseed ci --scope packages --json', 'Automate package CI checks', 'Emit structured package workflow status for agents and scripts.'),
			],
			automationNotes: [
				'`--json` includes the full repository list plus a flattened `failures` array.',
				'The command is read-only; it does not wait, rerun, or mutate GitHub Actions runs.',
			],
			relatedDetails: [
				related('status', 'Use `status` for local workspace health before inspecting hosted CI.'),
				related('save', 'Use `save` before CI inspection when local changes need to be pushed.'),
				related('stage', 'Use `stage` after hosted CI is healthy and the task is ready for staging.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'ci',
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
	['stage', command({
		arguments: [{ name: 'message', description: 'Resolution message for the staged task.', required: true, kind: 'message_tail' }],
		options: [
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive staging plan without mutating any repo.', kind: 'boolean' },
			{ name: 'verify', flags: '--verify <mode>', description: 'Choose local proof before staging is mutated.', kind: 'enum', values: ['action', 'local', 'none'] },
			{ name: 'ciMode', flags: '--ci <mode>', description: 'Control hosted GitHub Actions waits after staging refs are promoted.', kind: 'enum', values: ['hosted', 'off'] },
			{ name: 'async', flags: '--async', description: 'Return after exact refs are promoted instead of monitoring staging CI.', kind: 'boolean' },
			{ name: 'cleanup', flags: '--cleanup <mode>', description: 'Choose source branch/worktree cleanup after successful promotion.', kind: 'enum', values: ['success', 'manual'] },
			{ name: 'updateFrom', flags: '--update-from <branch>', description: 'Branch to merge down into the feature branch before promotion. Defaults to staging.', kind: 'string' },
			{ name: 'releaseCandidate', flags: '--release-candidate <mode>', description: 'Deprecated for stage; use release-candidate directly for explicit rehearsal.', kind: 'enum', values: ['hybrid', 'strict', 'skip'] },
			{ name: 'verifyDeployedResources', flags: '--verify-deployed-resources', description: 'Deprecated for stage; use hosting verification or the staging release agent after promotion.', kind: 'boolean' },
			{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed stage "feat: add search filters"', 'treeseed stage --plan "feat: add search filters"', 'treeseed stage --verify none --cleanup manual "handoff to staging agent"'],
		notes: ['Stage merges staging down into the feature branch before staging is mutated.', 'Stage performs local branch promotion by default; use --ci hosted only when hosted verification is intentionally required.', 'After staging refs are verified, stage deletes the exact merged source branches by default; use --cleanup manual only when they must be preserved intentionally.'],
		help: {
			workflowPosition: 'merge to staging',
			longSummary: [
				'Stage is the task completion command for the normal promotion path. It first merges staging down into the current feature branch, runs local proof, then promotes exact verified refs to staging.',
				'Hosted workflow monitoring is opt-in with --ci hosted; normal stage promotion does not deploy provider infrastructure.',
			],
			whenToUse: [
				'Use this when a task branch is ready for the staging environment.',
				'Use it instead of manual merge steps when you want the standard Treeseed task promotion workflow with conflict handling before staging is changed.',
			],
			outcomes: [
				'Merges staging into the feature branch first.',
				'Runs local proof before staging mutation by default.',
				'Promotes exact verified package and root SHAs to staging.',
				'Deletes exact merged source branches and cleans managed worktrees after staging refs are verified.',
			],
			examples: [
				example('treeseed stage "feat: add search filters"', 'Promote a completed task', 'Merge the current task branch into staging with a resolution message.'),
				example('treeseed stage --verify local "feat: package topology"', 'Stage with local proof', 'Use local package verification instead of gh act action-parity checks.'),
				example('treeseed stage --verify none --cleanup manual "handoff"', 'Merge-only handoff', 'Promote clean coherent refs and preserve source branches for a staging release agent.'),
				example('treeseed stage "fix: stabilize staging deploy"', 'Stage a fix branch', 'Advance a staging-targeted fix into the shared staging branch.'),
				example('treeseed stage --json "feat: add search filters"', 'Automate staging promotion', 'Emit structured workflow output during task promotion.'),
			],
			relatedDetails: [
				related('save', 'Use `save` while the task is still in progress.'),
				related('release', 'Use `release` after staging is in the state you want to promote to production.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'stage',
	})],
	['release-candidate', command({
		usage: 'treeseed release-candidate [--strict] [--verify-driver auto|local|action] [--package <id>]... [--json]',
		options: [
			{ name: 'mode', flags: '--mode <mode>', description: 'Release-candidate mode to run.', kind: 'enum', values: ['hybrid', 'strict', 'skip'] },
			{ name: 'strict', flags: '--strict', description: 'Require authoritative hosted proof for release-candidate subjects.', kind: 'boolean' },
			{ name: 'verifyDriver', flags: '--verify-driver <driver>', description: 'Choose proof driver. auto uses hosted proof for strict mode; action is advisory.', kind: 'enum', values: ['auto', 'local', 'action'] },
			{ name: 'skipAction', flags: '--skip-action', description: 'Use local proof commands instead of advisory action simulation.', kind: 'boolean' },
			{ name: 'package', flags: '--package <id>', description: 'Limit proof to one package id or name. Repeatable.', kind: 'string', multiple: true },
			{ name: 'keepWorkspace', flags: '--keep-workspace', description: 'Accepted for compatibility; proof-ledger runs do not create a rehearsal workspace.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Show the proof plan without running missing nodes.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed release-candidate --strict --json',
			'treeseed release-candidate --verify-driver local --json',
			'treeseed release-candidate --verify-driver action --package @treeseed/sdk --json',
		],
		help: {
			workflowPosition: 'release proof',
			longSummary: [
				'Release-candidate plans and runs reusable proof-ledger nodes for exact package refs.',
				'Strict release-candidate proof uses hosted GitHub workflow results as the authoritative CI/CD verdict.',
			],
			whenToUse: [
				'Use this before stage when package dependencies, manifests, TreeDX, workflow files, or publish packaging changed.',
				'Use this before production release, or let release run a fresh strict proof when no valid proof exists.',
				'Use --verify-driver action only as advisory workflow simulation; it cannot satisfy hosted release proof.',
			],
			outcomes: [
				'Reuses passed proof records when package refs and proof inputs are unchanged.',
				'Runs only missing or invalid proof subjects.',
				'Reports the exact failed proof subject and hosted workflow run when proof fails.',
			],
		},
		executionMode: 'handler',
		handlerName: 'release-candidate',
	})],
	['proof', command({
		usage: 'treeseed proof <plan|run|status|failures|explain|clean> [--target <environment>] [--driver <driver>] [--subject <id>] [--json]',
		arguments: [{ name: 'action', description: 'Proof action to run.', required: false }],
		options: [
			{ name: 'target', flags: '--target <environment>', description: 'Select proof target environment.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'driver', flags: '--driver <driver>', description: 'Select proof driver. github-hosted is authoritative; act is advisory.', kind: 'enum', values: ['github-hosted', 'act', 'local', 'railway-live', 'cloudflare-live', 'reconcile-live'] },
			{ name: 'subject', flags: '--subject <id>', description: 'Limit proof to one subject, such as package:treedx.', kind: 'string' },
			{ name: 'last', flags: '--last', description: 'Explain the most recent proof record.', kind: 'boolean' },
			{ name: 'olderThan', flags: '--older-than <duration>', description: 'Clean proof records older than a duration like 30d or 12h.', kind: 'string' },
			{ name: 'plan', flags: '--plan', description: 'Plan proof work without writing records.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON.', kind: 'boolean' },
		],
		examples: [
			'treeseed proof plan --target staging --json',
			'treeseed proof run --target staging --json',
			'treeseed proof run --subject package:treedx --driver github-hosted --json',
			'treeseed proof failures --json',
			'treeseed proof explain --last --json',
		],
		help: {
			workflowPosition: 'release proof',
			longSummary: [
				'Proof manages reusable release proof records for exact package refs, hosted GitHub workflows, and future provider live checks.',
				'GitHub-hosted workflow proof is authoritative for CI/CD. Local `act` proof is advisory and cannot satisfy promotion proof.',
			],
			whenToUse: [
				'Use `proof plan` before a promotion save to see which exact-SHA proof records are missing.',
				'Use `proof run` to observe or create authoritative hosted proof records.',
				'Use `proof failures` and `proof explain` after a slow or failed promotion run.',
			],
			outcomes: [
				'Reads or writes `.treeseed/workflow/proofs` records keyed by subject, driver, and input hash.',
				'Reports reusable proof records separately from missing or failed proof records.',
			],
		},
		executionMode: 'handler',
		handlerName: 'proof',
	})],
];
