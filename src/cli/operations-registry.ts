import {
	findTreeseedOperation as findSdkOperation,
	TRESEED_OPERATION_SPECS as SDK_OPERATION_SPECS,
} from '@treeseed/sdk/operations';
import type {
	TreeseedCommandArgumentSpec,
	TreeseedCommandHelpSpec,
	TreeseedCommandOptionSpec,
	TreeseedOperationMetadata,
	TreeseedOperationSpec,
	TreeseedParsedInvocation,
	TreeseedStructuredCommandExample,
} from './operations-types.ts';

type CommandOverlay = {
	usage?: string;
	arguments?: TreeseedCommandArgumentSpec[];
	options?: TreeseedCommandOptionSpec[];
	examples?: string[];
	help?: Partial<TreeseedCommandHelpSpec>;
	notes?: string[];
	helpVisible?: boolean;
	helpFeatured?: boolean;
	executionMode?: TreeseedOperationSpec['executionMode'];
	handlerName?: string;
	delegateTo?: TreeseedOperationSpec['delegateTo'];
	buildAdapterInput?: TreeseedOperationSpec['buildAdapterInput'];
};

function command(overlay: CommandOverlay): CommandOverlay {
	return overlay;
}

function example(commandLine: string, title: string, description: string, extras: Pick<TreeseedStructuredCommandExample, 'result' | 'why'> = {}): TreeseedStructuredCommandExample {
	return {
		command: commandLine,
		title,
		description,
		...extras,
	};
}

function detail(name: string, detailText: string) {
	return { name, detail: detailText };
}

function related(name: string, why: string) {
	return { name, why };
}

function genericWorkflowPosition(spec: Pick<TreeseedOperationMetadata, 'group' | 'name'>): string {
	if (spec.group === 'Workflow') {
		if (spec.name === 'switch') return 'start work';
		if (spec.name === 'save') return 'checkpoint work';
		if (spec.name === 'close') return 'abandon task';
		if (spec.name === 'stage') return 'merge to staging';
		if (spec.name === 'release') return 'promote to production';
		if (spec.name === 'rollback') return 'restore deployment';
		if (spec.name === 'destroy') return 'tear down environment';
		return 'workflow';
	}
	if (spec.group === 'Validation') return 'validate';
	if (spec.group === 'Local Development') return 'local runtime';
	if (spec.group === 'Release Utilities') return 'release utility';
	if (spec.group === 'Passthrough') return 'passthrough';
	return 'utility';
}

function genericExamples(spec: TreeseedOperationMetadata, overlay: CommandOverlay): TreeseedStructuredCommandExample[] {
	const overlayExamples = (overlay.examples ?? []).map((commandLine) => example(
		commandLine,
		'Example',
		`Run ${spec.name} with a representative argument set.`,
	));
	if (overlayExamples.length > 0) {
		return overlayExamples;
	}
	return [
		example(`treeseed ${spec.name}`, 'Basic invocation', `Run ${spec.name} with its default behavior.`),
	];
}

function genericLongSummary(spec: TreeseedOperationMetadata): string[] {
	return [
		spec.description || spec.summary,
		`This command belongs to the ${spec.group.toLowerCase()} surface and is exposed through the same registry that drives parsing, runtime dispatch, and help rendering.`,
	];
}

function genericWhenToUse(spec: TreeseedOperationMetadata): string[] {
	return [
		`Use this command when you need the ${spec.summary.replace(/\.$/u, '').toLowerCase()} workflow directly from the Treeseed CLI.`,
		`Reach for \`treeseed ${spec.name}\` when the command name matches the next action you want to take, and then move to related commands for the next stage of the workflow.`,
	];
}

function genericBeforeYouRun(spec: TreeseedOperationSpec): string[] {
	const lines = ['Run this command from a Treeseed workspace unless the command documentation explicitly says it can run outside a workspace.'];
	if ((spec.options ?? []).some((option) => option.name === 'json')) {
		lines.push('Decide up front whether you want human-readable output or machine-readable `--json` output so downstream automation and shell usage stay predictable.');
	}
	if (spec.executionMode === 'delegate') {
		lines.push('This command delegates to another runtime surface, so make sure the delegated runtime package is installed and available.');
	}
	return lines;
}

function genericOutcomes(spec: TreeseedOperationSpec): string[] {
	const relatedCommands = spec.related ?? [];
	return [
		`Running this command executes the ${spec.executionMode} path for \`${spec.name}\` and prints the result through the standard Treeseed CLI surface.`,
		...(relatedCommands.length > 0 ? [`After it completes, the most common next commands are ${relatedCommands.map((name) => `\`${name}\``).join(', ')}.`] : []),
	];
}

function genericAutomationNotes(spec: TreeseedOperationSpec): string[] {
	const lines = [
		spec.executionMode === 'adapter'
			? 'This command runs through an adapter path, so argument forwarding should be treated as package-script semantics rather than a handwritten workflow handler.'
			: 'This command runs through a CLI-owned workflow handler or delegate path and follows the Treeseed command parsing model directly.',
	];
	if ((spec.options ?? []).some((option) => option.name === 'json')) {
		lines.push('Use `--json` for scripts, agents, or other machine consumers that need stable structured output instead of human-formatted text.');
	} else {
		lines.push('This command does not expose a dedicated JSON output mode, so treat it as a human-facing command unless you are invoking the underlying package runtime directly.');
	}
	return lines;
}

function genericWarnings(spec: TreeseedOperationSpec): string[] {
	const warnings: string[] = [];
	if (spec.name === 'destroy' || spec.name === 'rollback') {
		warnings.push('This command can affect live or persistent environments. Confirm the target scope and the intended rollback or destroy boundary before running it.');
	}
	if (spec.name === 'release') {
		warnings.push('Release operations assume staging is the source of truth for what should move to production. Treat version bumps and promotion as deliberate release events.');
	}
	if (spec.executionMode === 'passthrough') {
		warnings.push('This command forwards to another CLI surface. Flags after `--` or positional forwarding may follow the target tool semantics rather than Treeseed-specific semantics.');
	}
	return warnings;
}

function genericRelatedDetails(spec: TreeseedOperationSpec) {
	return (spec.related ?? []).map((name) => related(name, `Use \`${name}\` next when you want to continue the workflow immediately after \`${spec.name}\`.`));
}

function mergeHelpSpec(metadata: TreeseedOperationMetadata, overlay: CommandOverlay, spec: Omit<TreeseedOperationSpec, 'help'>): TreeseedCommandHelpSpec {
	const base: TreeseedCommandHelpSpec = {
		workflowPosition: genericWorkflowPosition(metadata),
		longSummary: genericLongSummary(metadata),
		whenToUse: genericWhenToUse(metadata),
		beforeYouRun: genericBeforeYouRun(spec),
		outcomes: genericOutcomes(spec),
		examples: genericExamples(metadata, overlay),
		optionDetails: [],
		argumentDetails: [],
		automationNotes: genericAutomationNotes(spec),
		warnings: genericWarnings(spec),
		relatedDetails: genericRelatedDetails(spec),
		seeAlso: spec.related,
	};

	return {
		...base,
		...(overlay.help ?? {}),
		examples: overlay.help?.examples ?? base.examples,
		optionDetails: overlay.help?.optionDetails ?? base.optionDetails,
		argumentDetails: overlay.help?.argumentDetails ?? base.argumentDetails,
		relatedDetails: overlay.help?.relatedDetails ?? base.relatedDetails,
		seeAlso: overlay.help?.seeAlso ?? base.seeAlso,
	};
}

const PASS_THROUGH_ARGS = (invocation: TreeseedParsedInvocation) => ({ args: invocation.rawArgs });

const CLI_COMMAND_OVERLAYS = new Map<string, CommandOverlay>([
	['status', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed status', 'treeseed status --json'],
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
				'Choose `--json` when another tool or agent needs to read the status programmatically.',
			],
			outcomes: [
				'Prints the current branch role, project health, and related state without mutating the workspace.',
				'Gives you the orientation you need before choosing the next workflow command.',
			],
			examples: [
				example('treeseed status', 'Check the current task state', 'Show the current branch role and project health in human-readable form.'),
				example('treeseed status --json', 'Feed an agent or script', 'Emit structured status data for automation and external tooling.'),
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
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed tasks', 'treeseed tasks --json'],
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
			],
			examples: [
				example('treeseed tasks', 'List task branches', 'Show active task branches in the current workspace.'),
				example('treeseed tasks --json', 'Machine-readable task inventory', 'Emit the task list in JSON for scripts or agent tooling.'),
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
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive branch switch plan without mutating any repo.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
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
		arguments: [{ name: 'message', description: 'Git commit message for the save operation.', required: true, kind: 'message_tail' }],
		options: [
			{ name: 'hotfix', flags: '--hotfix', description: 'Allow save on main for an explicit hotfix.', kind: 'boolean' },
			{ name: 'preview', flags: '--preview', description: 'Create or refresh the branch preview during save.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive save plan without mutating any repo.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed save "feat: add search filters"', 'treeseed save --preview "feat: add search filters"', 'treeseed save --plan "feat: add search filters"', 'treeseed save --hotfix "fix: unblock production form submit"'],
		help: {
			workflowPosition: 'checkpoint work',
			longSummary: [
				'Save is the main task-branch checkpoint command. It verifies, commits, syncs, pushes, and can refresh the task preview so the branch remains in a clean, reviewable state.',
				'Use it instead of ad hoc manual git-and-preview sequences when you want the standard Treeseed task-save behavior.',
			],
			whenToUse: [
				'Use this after a meaningful unit of work on a task branch.',
				'Use `--preview` when the branch preview should be refreshed as part of the save operation.',
				'Use `--hotfix` only when you are intentionally saving from `main` for an explicit production hotfix flow.',
			],
			beforeYouRun: [
				'Run from a task branch unless you intentionally mean to use the hotfix path.',
				'Provide a commit message that captures the checkpoint clearly because Treeseed will use it for the save commit.',
			],
			outcomes: [
				'Verifies and commits current work using the provided message.',
				'Syncs and pushes branch state.',
				'Optionally refreshes preview infrastructure if requested.',
			],
			examples: [
				example('treeseed save "feat: add search filters"', 'Standard task checkpoint', 'Verify, commit, and push the current task branch with a descriptive message.'),
				example('treeseed save --preview "feat: add search filters"', 'Checkpoint plus preview refresh', 'Include preview refresh when the save should update the branch environment.'),
				example('treeseed save --hotfix "fix: unblock production form submit"', 'Explicit hotfix save', 'Allow a save from main when the work is a deliberate hotfix path.', { why: 'Use sparingly and only when the workflow intentionally bypasses the usual task-branch rule.' }),
			],
			warnings: [
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
	['close', command({
		arguments: [{ name: 'message', description: 'Reason for closing the task without staging it.', required: true, kind: 'message_tail' }],
		options: [
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive close plan without mutating any repo.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
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
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed stage "feat: add search filters"', 'treeseed stage --plan "feat: add search filters"'],
		notes: ['Auto-saves meaningful uncommitted task-branch changes before merging into staging.'],
		help: {
			workflowPosition: 'merge to staging',
			longSummary: [
				'Stage is the task completion command for the normal promotion path. It merges the current task into staging and then cleans up the task branch.',
			],
			whenToUse: [
				'Use this when a task branch is ready for the staging environment.',
				'Use it instead of manual merge steps when you want the standard Treeseed task promotion workflow.',
			],
			outcomes: [
				'Merges the task branch into staging.',
				'Performs task cleanup after the merge succeeds.',
				'Auto-saves meaningful uncommitted changes before the merge when necessary.',
			],
			examples: [
				example('treeseed stage "feat: add search filters"', 'Promote a completed task', 'Merge the current task branch into staging with a resolution message.'),
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
	['resume', command({
		arguments: [{ name: 'run-id', description: 'Interrupted workflow run id to resume.', required: true }],
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed resume save-abcd12', 'treeseed resume stage-ef3456 --json'],
		help: {
			workflowPosition: 'recover',
			longSummary: [
				'Resume continues a previously interrupted journaled workflow run from its next incomplete step.',
			],
			whenToUse: [
				'Use this after `treeseed recover` or a workflow failure tells you a run is resumable.',
			],
			beforeYouRun: [
				'Confirm the run id from `treeseed recover` and repair any missing remotes, credentials, or package drift that caused the interruption.',
			],
			outcomes: [
				'Re-enters the original workflow command using its recorded input and journal.',
			],
			automationNotes: [
				'`resume --json` preserves the versioned workflow result envelope so agents can continue from a known run id without reparsing a different shape.',
			],
		},
		executionMode: 'handler',
		handlerName: 'resume',
	})],
	['recover', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed recover', 'treeseed recover --json'],
		help: {
			workflowPosition: 'recover',
			longSummary: [
				'Recover lists the active workflow lock plus resumable interrupted runs so humans and agents can decide whether to resume, wait, or repair manually.',
			],
			whenToUse: [
				'Use this before starting a new mutating workflow when you suspect another run may already hold the workspace lock.',
				'Use this after any interrupted recursive save, stage, close, release, or destroy command.',
			],
			beforeYouRun: [
				'Run it from the market workspace root or anywhere inside the tenant so the CLI can inspect the correct `.treeseed/workflow` journal directory.',
			],
			outcomes: [
				'Reports the active workflow lock, interrupted runs, and the exact `treeseed resume <run-id>` command for resumable runs.',
			],
			automationNotes: [
				'`recover --json` is the supported discovery entrypoint for agents that need to inspect lock state and resumable run ids safely before mutating the workspace.',
			],
		},
		executionMode: 'handler',
		handlerName: 'recover',
	})],
	['rollback', command({
		arguments: [{ name: 'environment', description: 'The persistent environment to roll back.', required: true }],
		options: [
			{ name: 'to', flags: '--to <deploy-id|commit>', description: 'Explicit commit to roll back to. Defaults to the previous recorded deployment when omitted.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed rollback staging', 'treeseed rollback prod --to abc1234'],
		help: {
			workflowPosition: 'restore deployment',
			longSummary: [
				'Rollback restores a persistent environment to a previous deployment state. It is the fast recovery path when the latest staging or production deploy is not the version you want to keep live.',
			],
			whenToUse: [
				'Use this when a staging or production deployment must be reverted quickly.',
				'Use `--to` when the exact deploy or commit target is known and you do not want the default “previous deployment” behavior.',
			],
			beforeYouRun: [
				'Confirm the target environment carefully. Rollback acts on persistent environments only.',
				'If you know the exact deployment target, pass it explicitly with `--to` to avoid ambiguity.',
			],
			outcomes: [
				'Repoints the selected environment to an earlier deployment target.',
				'Returns structured rollback metadata when `--json` is requested.',
			],
			examples: [
				example('treeseed rollback staging', 'Rollback to the previous staging deployment', 'Use the default previous-deployment fallback when staging should revert one step.'),
				example('treeseed rollback prod --to abc1234', 'Rollback production to an explicit target', 'Pin the rollback to the exact deployment or commit you want to restore.'),
				example('treeseed rollback staging --json', 'Automate rollback tracking', 'Emit machine-readable rollback output for incident tooling or follow-up automation.'),
			],
			warnings: [
				'Rollback changes a persistent environment. Treat the target environment and deploy id as incident-response inputs, not casual experimentation.',
			],
			relatedDetails: [
				related('release', 'Use `release` for forward promotion when staging is healthy and should move to production.'),
				related('status', 'Use `status` to inspect the workspace before or after a rollback-driven response workflow.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'rollback',
	})],
	['doctor', command({
		options: [
			{ name: 'fix', flags: '--fix', description: 'Apply safe local repairs before rerunning diagnostics.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed doctor', 'treeseed doctor --fix --json'],
		help: {
			workflowPosition: 'validate',
			longSummary: [
				'Doctor diagnoses workflow blockers across tooling, auth, workspace state, and local configuration. It is the command to run when Treeseed feels broken and you want a prioritized explanation of what is wrong.',
			],
			whenToUse: [
				'Use this when other commands are failing or when onboarding a machine and you want a readiness report.',
				'Use `--fix` when you want Treeseed to apply safe local repairs before rerunning diagnostics.',
			],
			outcomes: [
				'Reports readiness issues and what must be fixed immediately.',
				'Optionally applies safe local fixes before re-checking.',
			],
			examples: [
				example('treeseed doctor', 'Run diagnostics only', 'Inspect the current machine and workspace without making repairs.'),
				example('treeseed doctor --fix', 'Repair safe local issues', 'Apply safe fixes first and then rerun diagnostics.'),
				example('treeseed doctor --fix --json', 'Integrate diagnostics with automation', 'Emit structured diagnostics and repair results for scripts or agents.'),
			],
			relatedDetails: [
				related('auth:check', 'Use `auth:check` when you only want a focused auth and prerequisite check.'),
				related('config', 'Use `config` when doctor points to missing environment or provider configuration.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'doctor',
	})],
	['auth:login', command({
		options: [
			{ name: 'host', flags: '--host <id>', description: 'Override the configured remote host id for this login.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed auth:login'],
		help: {
			longSummary: ['Auth:login authenticates the CLI against the configured Treeseed API so later provider-aware and remote-aware workflows can run without missing-credential failures.'],
			examples: [
				example('treeseed auth:login', 'Log in with the default host', 'Authenticate the CLI against the configured default Treeseed API host.'),
				example('treeseed auth:login --host production', 'Target a specific host id', 'Override the configured default host for this login session.'),
				example('treeseed auth:login --json', 'Automate auth workflows', 'Emit structured auth results where supported for scripts and agents.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'auth:login',
	})],
	['auth:logout', command({
		options: [
			{ name: 'host', flags: '--host <id>', description: 'Override the configured remote host id to clear.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed auth:logout'],
		help: {
			longSummary: ['Auth:logout clears the locally stored Treeseed API credentials for the selected host.'],
			examples: [
				example('treeseed auth:logout', 'Log out from the default host', 'Clear the current local Treeseed API session.'),
				example('treeseed auth:logout --host production', 'Clear a specific host session', 'Target a named host id rather than the default configured host.'),
				example('treeseed auth:logout --json', 'Track logout in automation', 'Emit structured auth-logout results when a script needs confirmation.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'auth:logout',
	})],
	['auth:whoami', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed auth:whoami'],
		help: {
			longSummary: ['Auth:whoami shows the currently active Treeseed API identity so you can verify which account and host context the CLI is using.'],
			examples: [
				example('treeseed auth:whoami', 'Inspect the active identity', 'Show the currently authenticated Treeseed API identity.'),
				example('treeseed auth:whoami --json', 'Read auth identity programmatically', 'Emit structured identity information for scripts and agents.'),
				example('treeseed auth:whoami && treeseed config', 'Check identity before configuration sync', 'Confirm the current account before running provider-backed config flows.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'auth:whoami',
	})],
	['template', command({
		usage: 'treeseed template [list|show|validate] [id]',
		arguments: [
			{ name: 'action', description: 'Template action: list, show, or validate.', required: false },
			{ name: 'id', description: 'Template id for show or validate.', required: false },
		],
		examples: ['treeseed template', 'treeseed template list', 'treeseed template show starter-basic', 'treeseed template validate'],
		help: {
			longSummary: [
				'Template exposes the Treeseed starter catalog so you can list, inspect, and validate starter definitions before using them for initialization or distribution work.',
			],
			examples: [
				example('treeseed template', 'Default to the catalog list', 'Show the available starters without specifying an action.'),
				example('treeseed template show starter-basic', 'Inspect a single starter', 'View the details of one starter template.'),
				example('treeseed template validate', 'Validate the current template set', 'Run template validation to confirm the catalog is internally consistent.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'template',
	})],
	['sync', command({
		options: [{ name: 'check', flags: '--check', description: 'Report managed-surface drift without changing files.', kind: 'boolean' }],
		examples: ['treeseed sync --check', 'treeseed sync'],
		help: {
			longSummary: [
				'Sync reconciles the managed template surface for the current site. It is the command to use when you want to check or restore generated/managed Treeseed surfaces.',
			],
			examples: [
				example('treeseed sync --check', 'Detect managed-surface drift', 'Report what would change without mutating files.'),
				example('treeseed sync', 'Apply managed-surface reconciliation', 'Bring managed surfaces back into sync with the current template model.'),
				example('trsd sync --check', 'Use the short alias', 'Run the same sync drift check through the short CLI entrypoint.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'sync',
	})],
	['init', command({
		arguments: [{ name: 'directory', description: 'Target directory for the new tenant.', required: true }],
		options: [
			{ name: 'template', flags: '--template <starter-id>', description: 'Select the starter template id to generate. Defaults to starter-basic.', kind: 'string' },
			{ name: 'name', flags: '--name <site-name>', description: 'Override the generated site name.', kind: 'string' },
			{ name: 'slug', flags: '--slug <slug>', description: 'Override the generated package and tenant slug.', kind: 'string' },
			{ name: 'siteUrl', flags: '--site-url <url>', description: 'Set the initial public site URL.', kind: 'string' },
			{ name: 'contactEmail', flags: '--contact-email <email>', description: 'Set the site contact address.', kind: 'string' },
			{ name: 'repo', flags: '--repo <url>', description: 'Set the repository URL.', kind: 'string' },
			{ name: 'discord', flags: '--discord <url>', description: 'Set the Discord/community URL.', kind: 'string' },
		],
		examples: ['treeseed init docs-site --template starter-basic --name "Docs Site" --site-url https://docs.example.com'],
		notes: ['Runs outside an existing repo or from any branch.'],
		help: {
			workflowPosition: 'create workspace',
			longSummary: [
				'Init scaffolds a new Treeseed tenant from the starter catalog. It is the entry point for creating a new project directory with the expected manifest, content layout, and runtime scaffolding.',
			],
			whenToUse: [
				'Use this when creating a brand-new Treeseed tenant.',
				'Use it outside an existing repo or from any branch because initialization targets a directory rather than the current branch lifecycle.',
			],
			beforeYouRun: [
				'Choose the target directory and starter template before running the command.',
				'Decide which identity fields you want to override at scaffold time, such as site name, slug, and public URL.',
			],
			outcomes: [
				'Creates the requested tenant directory and starter structure.',
				'Seeds the project metadata fields requested through the CLI flags.',
			],
			examples: [
				example('treeseed init docs-site --template starter-basic --name "Docs Site" --site-url https://docs.example.com', 'Create a starter site', 'Scaffold a new tenant using the basic starter and explicit branding metadata.'),
				example('treeseed init workbench --slug workbench --contact-email ops@example.com', 'Control project identity fields', 'Initialize a tenant while overriding slug and contact metadata at creation time.'),
				example('treeseed init docs-site --repo https://github.com/example/docs-site --discord https://discord.gg/example', 'Seed community and repository metadata', 'Attach repository and community URLs during project initialization.'),
			],
			relatedDetails: [
				related('config', 'Run `config` after init to set up environment variables, auth, and provider sync.'),
				related('dev', 'Run `dev` after init when you are ready to start the integrated local runtime.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'init',
	})],
	['config', command({
		options: [
			{ name: 'full', flags: '--full', description: 'Open the advanced full editor directly in human interactive mode.', kind: 'boolean' },
			{ name: 'environment', flags: '--environment <scope>', description: 'Select all environments or limit configuration to local, staging, or prod. Defaults to all.', kind: 'enum', repeatable: true, values: ['all', 'local', 'staging', 'prod'] },
			{ name: 'sync', flags: '--sync <mode>', description: 'Sync hosted secrets/variables to GitHub, Cloudflare, Railway, or all providers. Defaults to all.', kind: 'enum', values: ['none', 'github', 'cloudflare', 'railway', 'all'] },
			{ name: 'printEnv', flags: '--print-env', description: 'Print resolved environment values before remote initialization.', kind: 'boolean' },
			{ name: 'printEnvOnly', flags: '--print-env-only', description: 'Print resolved environment values, check provider connections, and exit without prompting or initializing remote resources.', kind: 'boolean' },
			{ name: 'showSecrets', flags: '--show-secrets', description: 'Print full secret values in environment reports instead of masking them.', kind: 'boolean' },
			{ name: 'rotateMachineKey', flags: '--rotate-machine-key', description: 'Regenerate the local home machine key and re-encrypt stored Treeseed secrets and remote auth sessions.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed config', 'treeseed config --full', 'treeseed config --environment all', 'treeseed config --environment local --sync none', 'treeseed config --environment staging --print-env-only --show-secrets', 'treeseed config --rotate-machine-key'],
		notes: ['Does not create branch preview deployments. Use `treeseed switch <branch> --preview` for that.'],
		help: {
			workflowPosition: 'configure runtime',
			longSummary: [
				'Config is the runtime foundation command for Treeseed. It resolves local and hosted environment values, captures missing values, runs the startup wizard or full editor for human use, and can synchronize provider-backed secrets and variables.',
				'Use it whenever environment configuration, provider auth, shared defaults, or machine-local secret state need to be inspected or updated.',
			],
			whenToUse: [
				'Use this during first-run setup, after new required environment variables are introduced, or when provider-backed configuration drift must be repaired.',
				'Use the startup wizard for onboarding and the full editor when you need complete per-variable control.',
			],
			beforeYouRun: [
				'Decide whether you want human interactive mode or machine-readable `--json` output before invoking the command.',
				'Choose the environment scope you care about: all, local, staging, or prod.',
				'If you plan to sync hosted state, make sure GitHub, Cloudflare, and Railway authentication is already configured or be ready to log in first.',
			],
			outcomes: [
				'Collects current, suggested, shared, and scoped environment values.',
				'Allows interactive editing for humans or structured application for automation.',
				'Optionally synchronizes hosted provider state and rotates the local machine key.',
			],
			examples: [
				example('treeseed config', 'Run the startup wizard', 'Open the newcomer-friendly configuration wizard in human TTY mode.'),
				example('treeseed config --full', 'Open the advanced editor directly', 'Skip the startup wizard and go straight to the full configuration surface.'),
				example('treeseed config --environment local --sync none', 'Edit local values without provider sync', 'Limit the session to local values and avoid hosted synchronization while iterating locally.'),
				example('treeseed config --environment staging --print-env-only --show-secrets', 'Inspect a resolved environment report', 'Print the resolved staging environment with full secret visibility and exit.'),
				example('treeseed config --rotate-machine-key', 'Rotate the local secret encryption key', 'Regenerate the machine key and re-encrypt locally stored Treeseed secrets.'),
			],
			optionDetails: [
				detail('--full', 'Enter the advanced editor directly instead of the startup wizard.'),
				detail('--environment <scope>', 'Filter configuration to `all`, `local`, `staging`, or `prod`.'),
				detail('--sync <mode>', 'Choose which provider surfaces should receive synchronized values after local updates are applied.'),
				detail('--print-env', 'Print the resolved environment values before remote initialization continues.'),
				detail('--print-env-only', 'Print the environment report and exit without interactive editing or remote initialization.'),
				detail('--rotate-machine-key', 'Rotate the local machine key used for encrypted Treeseed secret storage.'),
			],
			automationNotes: [
				'Use `--json` for non-interactive flows. Human TTY mode is where the startup wizard and full editor appear.',
				'`--print-env-only` and `--rotate-machine-key` are operational paths that bypass the interactive UI.',
				'Shared versus scoped environment semantics are resolved inside the SDK; the CLI help should be treated as the operator-facing explanation layer.',
			],
			warnings: [
				'This command does not create branch preview deployments. Use `switch --preview` for task-preview lifecycle work.',
				'When `--show-secrets` is enabled, output is intentionally unmasked. Avoid using it in logs or shared terminals unless that disclosure is acceptable.',
			],
			relatedDetails: [
				related('doctor', 'Use `doctor` when the problem is diagnostic uncertainty rather than direct environment editing.'),
				related('auth:login', 'Use `auth:login` when provider-backed operations fail because the CLI is not authenticated.'),
				related('switch', 'Use `switch --preview` for branch preview lifecycle work, which is intentionally separate from config.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'config',
	})],
	['export', command({
		arguments: [{ name: 'directory', description: 'Directory subtree to export. Defaults to the current shell directory.', required: false }],
		options: [
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed export', 'treeseed export src', 'treeseed export packages/sdk --json'],
		help: {
			workflowPosition: 'package codebase',
			longSummary: [
				'Export generates a Markdown codebase snapshot for the selected directory using the SDK-owned Repomix integration. It is designed for AI context bundling and archival of the current project tree.',
			],
			whenToUse: [
				'Use this when you need a portable Markdown snapshot of a project subtree for AI context, review, or archival.',
				'Use the positional directory when you want to export a subtree instead of the current shell directory.',
			],
			beforeYouRun: [
				'Run from somewhere inside the Treeseed project you want to export, or pass the exact subtree explicitly.',
				'Remember that `.treeseed/exports` is always ignored so exports do not recursively contain older exports.',
			],
			outcomes: [
				'Writes a Markdown package under `.treeseed/exports` relative to the exported directory.',
				'Reports branch, timestamp, ignore patterns, and summary metadata.',
			],
			examples: [
				example('treeseed export', 'Export from the current shell directory', 'Generate a codebase snapshot rooted at the directory you are currently in.'),
				example('treeseed export src', 'Export a source subtree', 'Limit the snapshot to the `src` subtree relative to the current workspace.'),
				example('treeseed export packages/sdk --json', 'Use export in automation', 'Emit structured metadata about the generated Markdown snapshot.'),
			],
			warnings: [
				'The export output directory is always relative to the directory being exported, not necessarily the tenant root.',
			],
			relatedDetails: [
				related('config', 'Use `config` when you need runtime configuration context rather than a code snapshot.'),
				related('status', 'Use `status` to understand workflow state before capturing a code export for external analysis.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'export',
	})],
	['release', command({
		usage: 'treeseed release --major|--minor|--patch',
		options: [
			{ name: 'major', flags: '--major', description: 'Bump to the next major version.', kind: 'boolean' },
			{ name: 'minor', flags: '--minor', description: 'Bump to the next minor version.', kind: 'boolean' },
			{ name: 'patch', flags: '--patch', description: 'Bump to the next patch version.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive release plan without mutating any repo.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed release --patch', 'treeseed release --minor', 'treeseed release --patch --plan'],
		notes: ['Requires exactly one bump flag.'],
		help: {
			workflowPosition: 'promote to production',
			longSummary: [
				'Release promotes the staging state to production while applying a version bump. It is the forward promotion command once staging reflects the exact state you intend to publish.',
			],
			whenToUse: [
				'Use this only when staging is the approved source for production promotion.',
				'Choose exactly one bump flag so the release version reflects the intended change size.',
			],
			beforeYouRun: [
				'Confirm staging is in the state you want to promote.',
				'Choose one of `--major`, `--minor`, or `--patch` before running the command.',
			],
			outcomes: [
				'Promotes the release forward and records the version bump.',
				'Returns release metadata in JSON mode when requested.',
			],
			examples: [
				example('treeseed release --patch', 'Patch release', 'Promote staging to production with the next patch version.'),
				example('treeseed release --minor', 'Minor release', 'Promote staging with the next minor version bump.'),
				example('treeseed release --patch --json', 'Automate release tracking', 'Emit structured release output for tooling that records deployments and version changes.'),
			],
			warnings: [
				'Exactly one bump flag is required.',
				'This is a production-facing promotion command, not a dry local build operation.',
			],
			relatedDetails: [
				related('stage', 'Use `stage` first to move completed task work into staging before releasing.'),
				related('rollback', 'Use `rollback` when a staging or production deployment must be restored to an earlier state.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'release',
	})],
	['destroy', command({
		usage: 'treeseed destroy --environment <local|staging|prod> [--plan|--dry-run] [--force] [--skip-confirmation] [--confirm <slug>] [--remove-build-artifacts]',
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Select the persistent environment to destroy.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'plan', flags: '--plan', description: 'Compute the destroy plan without mutating the environment.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'force', flags: '--force', description: 'Force worker deletion when supported.', kind: 'boolean' },
			{ name: 'skipConfirmation', flags: '--skip-confirmation', description: 'Skip the interactive confirmation prompt.', kind: 'boolean' },
			{ name: 'confirm', flags: '--confirm <slug>', description: 'Provide the expected slug confirmation non-interactively.', kind: 'string' },
			{ name: 'removeBuildArtifacts', flags: '--remove-build-artifacts', description: 'Also remove local build artifacts after destroy.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed destroy --environment staging --plan', 'treeseed destroy --environment prod --confirm example --skip-confirmation'],
		notes: ['Only for persistent environments. Task cleanup belongs to treeseed close.', 'This command is destructive and requires explicit confirmation.'],
		help: {
			workflowPosition: 'tear down environment',
			longSummary: [
				'Destroy tears down a persistent environment and, optionally, related local build artifacts. It is the destructive environment cleanup command and should be treated as an explicit operator workflow.',
			],
			whenToUse: [
				'Use this when a persistent environment should be intentionally removed rather than rolled back or updated.',
				'Use `--plan` first when you want to inspect the destroy plan without committing to it.',
			],
			beforeYouRun: [
				'Confirm the environment scope exactly. This command does not target task-branch cleanup; it targets persistent environments only.',
				'Plan your confirmation strategy: interactive prompt, `--skip-confirmation`, or explicit `--confirm <slug>`.',
			],
			outcomes: [
				'Destroys the selected persistent environment resources according to provider support.',
				'Optionally removes local build artifacts if requested.',
			],
			examples: [
				example('treeseed destroy --environment staging --plan', 'Preview the destroy plan', 'Inspect what would be removed from staging without actually performing the destroy.'),
				example('treeseed destroy --environment prod --confirm example --skip-confirmation', 'Run a deliberate non-interactive destroy', 'Provide the expected slug explicitly when operating in a scripted or no-prompt environment.'),
				example('treeseed destroy --environment local --remove-build-artifacts', 'Remove a local environment and its artifacts', 'Destroy the local environment and also delete local build outputs.'),
			],
			warnings: [
				'This command is destructive.',
				'Persistent environment destroy is not the same thing as task cleanup. Use `close` for task-branch archival.',
			],
			relatedDetails: [
				related('rollback', 'Use `rollback` when the environment should remain but move back to an earlier deployment.'),
				related('close', 'Use `close` when the thing you want to clean up is a task branch, not a persistent environment.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'destroy',
	})],
	['dev', command({
		examples: ['treeseed dev'],
		help: {
			longSummary: ['Dev starts the unified local Treeseed runtime so you can work against the integrated web, API, and supporting local surfaces.'],
			examples: [
				example('treeseed dev', 'Start integrated local development', 'Run the default integrated local runtime.'),
				example('trsd dev', 'Use the short alias', 'Start the same local runtime through the shorter entrypoint.'),
				example('treeseed dev && treeseed status', 'Pair runtime start with orientation', 'Start the local runtime and then inspect workflow state in another shell.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'dev',
	})],
	['dev:watch', command({
		examples: ['treeseed dev:watch'],
		help: {
			longSummary: ['Dev:watch starts local development with rebuild and watch semantics so code changes are reflected continuously during active development.'],
			examples: [
				example('treeseed dev:watch', 'Start watch mode', 'Run the local runtime with watch and rebuild behavior enabled.'),
				example('trsd dev:watch', 'Use the short alias', 'Start the same watch-mode runtime through the shorter entrypoint.'),
				example('treeseed dev:watch --help', 'Inspect watch help', 'Read the help surface before starting a longer watch session.'),
			],
		},
		executionMode: 'handler',
		handlerName: 'dev',
	})],
	['build', command({ examples: ['treeseed build'], help: { longSummary: ['Build runs the tenant build path and produces the generated output for the current project.'], examples: [example('treeseed build', 'Build the tenant', 'Run the packaged build flow for the current project.'), example('trsd build', 'Use the short alias', 'Run the same build through the shorter entrypoint.'), example('treeseed build && treeseed export', 'Build before packaging context', 'Produce build artifacts first and then capture a code export if needed.')] }, executionMode: 'adapter' })],
	['check', command({ examples: ['treeseed check'], help: { longSummary: ['Check runs the project validation path against the current tenant and shared fixture model.'], examples: [example('treeseed check', 'Validate the tenant', 'Run the project check flow.'), example('trsd check', 'Use the short alias', 'Run the same validation via the short entrypoint.'), example('treeseed check && treeseed doctor', 'Pair validation with diagnostics', 'Follow failed checks with the broader doctor surface.')] }, executionMode: 'adapter' })],
	['preview', command({ examples: ['treeseed preview'], help: { longSummary: ['Preview serves the built tenant output locally so you can inspect the built site rather than the live dev runtime.'], examples: [example('treeseed preview', 'Preview the built site', 'Run the packaged preview flow for the built tenant.'), example('treeseed preview -- --help', 'Forward preview help', 'Pass through additional args when the preview runtime supports them.'), example('treeseed build && treeseed preview', 'Build then preview', 'Generate the build output first and then serve it locally.')] }, executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
	['lint', command({ examples: ['treeseed lint'], help: { longSummary: ['Lint runs the project linting and related surface checks for the current tenant.'], examples: [example('treeseed lint', 'Run lint', 'Execute the lint checks for the current project.'), example('trsd lint', 'Use the short alias', 'Run the same lint checks through the shorter entrypoint.'), example('treeseed lint && treeseed test:unit', 'Lint before unit tests', 'Use lint as a first local verification step.')] }, executionMode: 'adapter' })],
	['test', command({ examples: ['treeseed test'], help: { longSummary: ['Test runs the default Treeseed test surface for the current project.'], examples: [example('treeseed test', 'Run the default test suite', 'Execute the standard project test flow.'), example('trsd test', 'Use the short alias', 'Run the same test surface with the shorter entrypoint.'), example('treeseed test && treeseed build', 'Verify before building', 'Run tests before the build step in a local verification loop.')] }, executionMode: 'adapter' })],
	['test:unit', command({ examples: ['treeseed test:unit'], help: { longSummary: ['Test:unit runs workspace unit tests in dependency order.'], examples: [example('treeseed test:unit', 'Run unit tests', 'Execute the package unit test flow.'), example('trsd test:unit', 'Use the short alias', 'Run the same unit tests via the short entrypoint.'), example('treeseed test:unit && treeseed check', 'Unit tests then validation', 'Combine focused tests with broader tenant validation.')] }, executionMode: 'adapter' })],
	['preflight', command({ examples: ['treeseed preflight'], help: { longSummary: ['Preflight checks local prerequisites and authentication state before heavier workflows run.'], examples: [example('treeseed preflight', 'Run the preflight checklist', 'Inspect local prerequisites and auth readiness.'), example('trsd preflight', 'Use the short alias', 'Run the same readiness check via the short entrypoint.'), example('treeseed preflight && treeseed dev', 'Validate before starting local runtime', 'Confirm readiness before launching the integrated dev surface.')] }, executionMode: 'adapter' })],
	['auth:check', command({ examples: ['treeseed auth:check'], executionMode: 'adapter', buildAdapterInput: () => ({ requireAuth: true }) })],
	['test:e2e', command({ examples: ['treeseed test:e2e'], executionMode: 'adapter' })],
	['test:e2e:local', command({ examples: ['treeseed test:e2e:local'], executionMode: 'adapter' })],
	['test:e2e:staging', command({ examples: ['treeseed test:e2e:staging'], executionMode: 'adapter' })],
	['test:e2e:full', command({ examples: ['treeseed test:e2e:full'], executionMode: 'adapter' })],
	['test:release', command({ examples: ['treeseed test:release'], executionMode: 'adapter' })],
	['test:release:full', command({ examples: ['treeseed test:release:full', 'treeseed release:verify'], executionMode: 'adapter' })],
	['release:publish:changed', command({ examples: ['treeseed release:publish:changed'], executionMode: 'adapter' })],
	['astro', command({ examples: ['treeseed astro -- --help'], executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
	['sync:devvars', command({ examples: ['treeseed sync:devvars'], executionMode: 'adapter' })],
	['mailpit:up', command({ examples: ['treeseed mailpit:up'], executionMode: 'adapter' })],
	['mailpit:down', command({ examples: ['treeseed mailpit:down'], executionMode: 'adapter' })],
	['mailpit:logs', command({ examples: ['treeseed mailpit:logs'], executionMode: 'adapter' })],
	['d1:migrate:local', command({ examples: ['treeseed d1:migrate:local'], executionMode: 'adapter' })],
	['cleanup:markdown', command({
		examples: ['treeseed cleanup:markdown docs/README.md'],
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({ targets: invocation.positionals, check: false }),
	})],
	['cleanup:markdown:check', command({
		examples: ['treeseed cleanup:markdown:check docs/README.md'],
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({ targets: invocation.positionals, check: true }),
	})],
	['starlight:patch', command({ examples: ['treeseed starlight:patch'], executionMode: 'adapter' })],
]);

const CLI_ONLY_OPERATION_SPECS: TreeseedOperationSpec[] = [
	{
		id: 'agents.run',
		name: 'agents',
		aliases: [],
		group: 'Utilities',
		summary: 'Run the Treeseed agent runtime namespace.',
		description: 'Delegate to the integrated `@treeseed/core` agent runtime namespace and forward the remaining subcommand arguments.',
		provider: 'default',
		related: ['status', 'config'],
		usage: 'treeseed agents <command>',
		arguments: [{ name: 'command', description: 'Agent subcommand and its remaining arguments.', required: false }],
		examples: ['treeseed agents --help'],
		help: {
			longSummary: [
				'Agents is the CLI entrypoint into the integrated Treeseed agent runtime namespace. It forwards the remaining subcommand arguments to the runtime owned by `@treeseed/core`.',
			],
			whenToUse: [
				'Use this when the thing you want is inside the agent runtime namespace rather than the main Treeseed command set.',
			],
			beforeYouRun: [
				'Make sure the integrated `@treeseed/core` runtime is installed and available because this command delegates rather than handling the work locally.',
			],
			outcomes: [
				'Passes control to the agent runtime and forwards the remaining arguments unchanged.',
			],
			examples: [
				example('treeseed agents --help', 'List available agent subcommands', 'Inspect the delegated agent namespace before invoking a specific subcommand.'),
				example('trsd agents --help', 'Use the short alias', 'Reach the same agent namespace through the shorter CLI entrypoint.'),
				example('treeseed agents <command>', 'Delegate a specific agent action', 'Forward an agent subcommand and its arguments to the integrated runtime.'),
			],
			automationNotes: [
				'This command delegates directly to another runtime surface, so downstream semantics come from the agent namespace after the handoff.',
			],
			relatedDetails: [
				related('status', 'Use `status` when you need the main Treeseed workflow state rather than the delegated agent namespace.'),
				related('config', 'Use `config` when agent work depends on missing environment or auth setup.'),
			],
		},
		notes: [
			'Delegates to the integrated `@treeseed/core` agent runtime.',
			'Use `treeseed agents --help` to list supported agent subcommands.',
		],
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'delegate',
		delegateTo: 'agents',
	},
];

function mergeOperationSpec(metadata: TreeseedOperationMetadata): TreeseedOperationSpec {
	const overlay = CLI_COMMAND_OVERLAYS.get(metadata.name) ?? {};
	const specWithoutHelp: Omit<TreeseedOperationSpec, 'help'> = {
		...metadata,
		usage: overlay.usage,
		arguments: overlay.arguments,
		options: overlay.options,
		examples: overlay.examples,
		notes: overlay.notes,
		helpVisible: overlay.helpVisible ?? true,
		helpFeatured: overlay.helpFeatured ?? metadata.group === 'Workflow',
		executionMode: overlay.executionMode ?? 'adapter',
		handlerName: overlay.handlerName,
		delegateTo: overlay.delegateTo,
		buildAdapterInput: overlay.buildAdapterInput,
	};
	return {
		...specWithoutHelp,
		help: mergeHelpSpec(metadata, overlay, specWithoutHelp),
	};
}

export const TRESEED_OPERATION_SPECS: TreeseedOperationSpec[] = [
	...SDK_OPERATION_SPECS.map(mergeOperationSpec),
	...CLI_ONLY_OPERATION_SPECS,
];

export const TRESEED_OPERATION_INDEX = new Map<string, TreeseedOperationSpec>();
for (const spec of TRESEED_OPERATION_SPECS) {
	TRESEED_OPERATION_INDEX.set(spec.name, spec);
	for (const alias of spec.aliases) {
		TRESEED_OPERATION_INDEX.set(alias, spec);
	}
}

export function findTreeseedOperation(name: string | null | undefined) {
	if (!name) return null;
	const directMatch = TRESEED_OPERATION_INDEX.get(name);
	if (directMatch) {
		return directMatch;
	}
	const metadata = findSdkOperation(name);
	return metadata ? (TRESEED_OPERATION_INDEX.get(metadata.name) ?? mergeOperationSpec(metadata)) : null;
}

export function listTreeseedOperationNames() {
	return [...new Set(TRESEED_OPERATION_SPECS.map((spec) => spec.name))];
}
