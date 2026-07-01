import {
	findTreeseedOperation as findSdkOperation,
	TRESEED_OPERATION_SPECS as SDK_OPERATION_SPECS,
} from '@treeseed/sdk/operations';
import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
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

const workspaceCommand = (name: 'status' | 'link' | 'unlink') => `workspace${':'}${name}`;

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

const DEV_RUNTIME_OPTIONS: TreeseedCommandOptionSpec[] = [
	{ name: 'host', flags: '--host <host>', description: 'Host for the web dev server.', kind: 'string' },
	{ name: 'port', flags: '--port <port>', description: 'Port for the web dev server.', kind: 'string' },
	{ name: 'webRuntime', flags: '--web-runtime <mode>', description: 'Choose the local web runtime. Use local for Astro hot reload or provider for provider parity.', kind: 'enum', values: ['auto', 'local', 'provider'] },
	{ name: 'app', flags: '--app <app-id>', description: 'Select a discovered Treeseed app for local dev, such as web or api.', kind: 'string' },
	{ name: 'api', flags: '--api <mode>', description: 'Choose whether the web app uses a local API app or a configured remote API.', kind: 'enum', values: ['auto', 'local', 'remote'] },
	{ name: 'apiHost', flags: '--api-host <host>', description: 'Host used to construct the local API URL.', kind: 'string' },
	{ name: 'apiPort', flags: '--api-port <port>', description: 'Port for the local API server.', kind: 'string' },
	{ name: 'setup', flags: '--setup <mode>', description: 'Control automatic local runtime setup.', kind: 'enum', values: ['auto', 'check', 'off'] },
	{ name: 'feedback', flags: '--feedback <mode>', description: 'Control live feedback, service restarts, and browser reload stamps.', kind: 'enum', values: ['live', 'restart', 'off'] },
	{ name: 'open', flags: '--open <mode>', description: 'Control whether dev opens the browser after readiness. Defaults to off; use --open on to launch it.', kind: 'enum', values: ['auto', 'on', 'off'] },
	{ name: 'localContent', flags: '--local-content <mode>', description: 'Control local content materialization. auto reports existing paths, none never clones, preview/edit materialize managed content when requested.', kind: 'enum', values: ['auto', 'none', 'preview', 'edit'] },
	{ name: 'plan', flags: '--plan', description: 'Print the dev runtime plan and exit without starting services.', kind: 'boolean' },
	{ name: 'reset', flags: '--reset', description: 'Clear local dev runtime state before setup, migrations, and service startup.', kind: 'boolean' },
	{ name: 'force', flags: '--force', description: 'Replace the current worktree dev instance before startup.', kind: 'boolean' },
	{ name: 'forceConflicts', flags: '--force-conflicts', description: 'Allow managed dev start to stop sibling worktree port owners when explicit ports conflict.', kind: 'boolean' },
	{ name: 'all', flags: '--all', description: 'Apply managed dev status or stop to all worktrees in the repository family.', kind: 'boolean' },
	{ name: 'follow', flags: '--follow', description: 'Follow managed dev logs when supported.', kind: 'boolean' },
	{ name: 'json', flags: '--json', description: 'Emit structured JSON or newline-delimited dev events.', kind: 'boolean' },
	{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
];

const DEV_STATUS_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => ['all', 'json'].includes(option.name));
const DEV_LOGS_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => ['follow', 'json'].includes(option.name));
const DEV_STOP_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => ['all', 'json'].includes(option.name));
const DEV_START_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => !['all', 'follow'].includes(option.name));

function devManagedHelpCommand(
	subcommand: 'start' | 'status' | 'logs' | 'stop' | 'restart',
	spec: {
		summary: string;
		description: string;
		usage: string;
		options: TreeseedCommandOptionSpec[];
		examples: TreeseedStructuredCommandExample[];
		whenToUse: string[];
		beforeYouRun: string[];
		outcomes: string[];
		warnings?: string[];
	},
): TreeseedOperationSpec {
	return {
		id: `dev.${subcommand}` as TreeseedOperationSpec['id'],
		name: `dev ${subcommand}`,
		aliases: [],
		group: 'Local Development',
		summary: spec.summary,
		description: spec.description,
		provider: 'default',
		related: ['dev'],
		usage: spec.usage,
		options: spec.options,
		examples: spec.examples,
		helpVisible: false,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'dev',
		help: {
			workflowPosition: 'managed dev instance',
			longSummary: [spec.description],
			whenToUse: spec.whenToUse,
			beforeYouRun: spec.beforeYouRun,
			outcomes: spec.outcomes,
			examples: spec.examples,
			automationNotes: [
				'These managed dev subcommands use the same `dev` handler and core supervisor as foreground `treeseed dev`.',
				'Use `--json` when another process needs stable instance records, ports, URLs, PIDs, ready checks, or log paths.',
			],
			warnings: spec.warnings ?? [],
			relatedDetails: [
				related('dev', 'Use `dev` without a subcommand for the foreground supervisor.'),
			],
			seeAlso: ['dev'],
		},
	};
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
	if (spec.group === 'Passthrough') {
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

const TOOL_WRAPPER_OPTIONS: TreeseedCommandOptionSpec[] = [
	{ name: 'environment', flags: '--environment <scope>', description: 'Treeseed environment scope used to decrypt and inject provider credentials.', kind: 'enum', values: ['local', 'staging', 'prod'] },
];

const CLI_COMMAND_OVERLAYS = new Map<string, CommandOverlay>([
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
			{ name: 'worktree', flags: '--worktree', description: 'Open or resume the task in a managed workflow worktree.', kind: 'boolean' },
			{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
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
		arguments: [{ name: 'message', description: 'Optional hint for generated save commit messages.', required: false, kind: 'message_tail' }],
		options: [
			{ name: 'hotfix', flags: '--hotfix', description: 'Allow save on main for an explicit hotfix.', kind: 'boolean' },
			{ name: 'preview', flags: '--preview', description: 'Create or refresh the branch preview during save.', kind: 'boolean' },
			{ name: 'lane', flags: '--lane <mode>', description: 'Select save lane: fast local checkpoint or promotion-grade hosted checks.', kind: 'enum', values: ['fast', 'promotion'] },
			{ name: 'ciMode', flags: '--ci <mode>', description: 'Control hosted GitHub Actions waits.', kind: 'enum', values: ['auto', 'hosted', 'off'] },
			{ name: 'verifyMode', flags: '--verify <mode>', description: 'Control save verification depth.', kind: 'enum', values: ['fast', 'local', 'hosted', 'both', 'skip'] },
			{ name: 'releaseCandidate', flags: '--release-candidate <mode>', description: 'Control staging save release-candidate checks.', kind: 'enum', values: ['hybrid', 'strict', 'skip'] },
			{ name: 'verifyDeployedResources', flags: '--verify-deployed-resources', description: 'Also wait for hosted deployment checks that verify provider resources.', kind: 'boolean' },
			{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive save plan without mutating any repo.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed save', 'treeseed save "add search filters"', 'treeseed save --preview', 'treeseed save --lane promotion', 'treeseed save --release-candidate strict', 'treeseed save --plan', 'treeseed save --hotfix "fix production form submit"'],
		help: {
			workflowPosition: 'checkpoint work',
			longSummary: [
				'Save is the main task-branch checkpoint command. It verifies, commits, syncs, pushes, and can refresh the task preview so the branch remains in a clean, reviewable state.',
				'Use it instead of ad hoc manual git-and-preview sequences when you want the standard Treeseed task-save behavior.',
				'Save has two lanes. The default fast lane is for routine integrated checkpoints and does not run release-candidate. The explicit promotion lane is for checkpoints that should wait for hosted gates and strict release-candidate proof.',
			],
			whenToUse: [
				'Use this after a meaningful unit of work on a task branch.',
				'Use the default fast lane for routine code, docs, and low-risk package checkpoints where package pointers and lockfile validation are enough.',
				'Use `--verify local` when a fast-lane checkpoint should also run package-local verification before pushing.',
				'Use `--preview` when the branch preview should be refreshed as part of the save operation.',
				'Use `--lane promotion` when a save should wait for hosted gates and strict release-candidate checks like a promotion rehearsal.',
				'Use `--verify-deployed-resources` on staging or production branches when the checkpoint should wait for deployed provider resources to be verified.',
				'Use `--release-candidate strict` on staging when dependency topology changed and you want a full clean-install rehearsal before saving.',
				'Use `--hotfix` only when you are intentionally saving from `main` for an explicit production hotfix flow.',
			],
			beforeYouRun: [
				'Run from a task branch unless you intentionally mean to use the hotfix path.',
				'Optionally provide a short hint; Treeseed generates the final commit message from the diff and hint.',
			],
			outcomes: [
				'Verifies and commits current work using a generated commit message.',
				'Syncs and pushes branch state.',
				'Fast lane saves dependency-ordered repos without hosted CI/deploy waits or strict clean-install rehearsal unless another option requests them.',
				'Promotion lane waits for hosted gates on staging and uses strict release-candidate checks by default.',
				'Optionally refreshes preview infrastructure if requested.',
			],
			examples: [
				example('treeseed save', 'Fast checkpoint', 'Commit and push the current task branch through the default fast lane.'),
				example('treeseed save "add search filters"', 'Checkpoint with a hint', 'Feed a short hint into commit-message generation without replacing the generated message.'),
				example('treeseed save --verify local "add search filters"', 'Fast checkpoint with local verification', 'Keep hosted waits off while running package-local verification before pushing.'),
				example('treeseed save --lane promotion "prove dependency topology"', 'Promotion-grade checkpoint', 'Wait for hosted staging gates and strict release-candidate proof before returning.'),
				example('treeseed save --preview', 'Checkpoint plus preview refresh', 'Include preview refresh when the save should update the branch environment.'),
				example('treeseed save --hotfix "fix production form submit"', 'Explicit hotfix save', 'Allow a save from main when the work is a deliberate hotfix path.', { why: 'Use sparingly and only when the workflow intentionally bypasses the usual task-branch rule.' }),
			],
			warnings: [
				'Fast lane is intentionally optimized for iteration. Use `release-candidate --strict`, `release`, or `save --lane promotion` when full proof is required.',
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
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
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
			{ name: 'verify', flags: '--verify <mode>', description: 'Choose local proof before staging is mutated.', kind: 'enum', values: ['action', 'local', 'none'] },
			{ name: 'ciMode', flags: '--ci <mode>', description: 'Control hosted GitHub Actions waits after staging refs are promoted.', kind: 'enum', values: ['hosted', 'off'] },
			{ name: 'cleanup', flags: '--cleanup <mode>', description: 'Choose source branch/worktree cleanup after successful promotion.', kind: 'enum', values: ['success', 'manual'] },
			{ name: 'updateFrom', flags: '--update-from <branch>', description: 'Branch to merge down into the feature branch before promotion. Defaults to staging.', kind: 'string' },
			{ name: 'releaseCandidate', flags: '--release-candidate <mode>', description: 'Deprecated for stage; use release-candidate directly for explicit rehearsal.', kind: 'enum', values: ['hybrid', 'strict', 'skip'] },
			{ name: 'verifyDeployedResources', flags: '--verify-deployed-resources', description: 'Deprecated for stage; use hosting verification or the staging release agent after promotion.', kind: 'boolean' },
			{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed stage "feat: add search filters"', 'treeseed stage --plan "feat: add search filters"', 'treeseed stage --verify none --cleanup manual "handoff to staging agent"'],
		notes: ['Stage merges staging down into the feature branch before staging is mutated.', 'Stage runs local action-parity proof by default and does not wait for hosted CI/CD unless --ci hosted is provided.', 'Source branches and managed worktrees are preserved by default; use --cleanup success only when cleanup is intentionally safe.'],
		help: {
			workflowPosition: 'merge to staging',
			longSummary: [
				'Stage is the task completion command for the normal promotion path. It first merges staging down into the current feature branch, runs local proof, then promotes exact verified refs to staging.',
				'It does not wait for hosted CI/CD, Railway, Cloudflare, or live provider checks by default. A separate staging release agent can repair deployed staging after refs move.',
			],
			whenToUse: [
				'Use this when a task branch is ready for the staging environment.',
				'Use it instead of manual merge steps when you want the standard Treeseed task promotion workflow with conflict handling before staging is changed.',
			],
			outcomes: [
				'Merges staging into the feature branch first.',
				'Runs local proof before staging mutation by default.',
				'Promotes exact verified package and root SHAs to staging.',
				'Preserves source branches and managed worktrees by default after staging refs are verified.',
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
			{ name: 'strict', flags: '--strict', description: 'Run strict local release graph rehearsal.', kind: 'boolean' },
			{ name: 'verifyDriver', flags: '--verify-driver <driver>', description: 'Choose local verification driver.', kind: 'enum', values: ['auto', 'local', 'action'] },
			{ name: 'skipAction', flags: '--skip-action', description: 'Force local verify scripts instead of gh act.', kind: 'boolean' },
			{ name: 'package', flags: '--package <id>', description: 'Limit rehearsal to one package id or name. Repeatable.', kind: 'string', multiple: true },
			{ name: 'keepWorkspace', flags: '--keep-workspace', description: 'Keep the temporary rehearsal workspace for debugging.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Show the rehearsal plan without running it.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed release-candidate --strict --json',
			'treeseed release-candidate --verify-driver local --json',
			'treeseed release-candidate --verify-driver action --package @treeseed/sdk --json',
		],
		help: {
			workflowPosition: 'local proof before hosted gates',
			longSummary: [
				'Release-candidate runs the explicit local package graph rehearsal and optional package GitHub Actions simulation.',
				'It is available at any time, is no longer part of default save/update/stage, and is required as strict proof before production release.',
			],
			whenToUse: [
				'Use this before stage when package dependencies, manifests, TreeDX, workflow files, or publish packaging changed.',
				'Use this before production release, or let release run a fresh strict proof when no valid proof exists.',
				'Use --verify-driver action when you need package workflow parity through managed gh act.',
			],
			outcomes: [
				'Builds internal npm packages in dependency order as local tarballs.',
				'Runs manifest-owned verification for image-service packages such as TreeDX.',
				'Fails locally before hosted GitHub Actions cost is incurred.',
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
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
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
		options: [
			{ name: 'pruneStale', flags: '--prune-stale', description: 'Archive stale interrupted runs that are no longer safe to resume.', kind: 'boolean' },
			{ name: 'obsolete', flags: '--obsolete <run-id>', description: 'Mark one failed workflow run obsolete so it will not be auto-resumed.', kind: 'string' },
			{ name: 'reason', flags: '--reason <text>', description: 'Reason to store when marking a workflow run obsolete.', kind: 'string' },
			{ name: 'gitLocks', flags: '--git-locks', description: 'Inspect safe recovery status for Git index lock files.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'Apply a safe Git lock repair when combined with --git-locks.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed recover', 'treeseed recover --json', 'treeseed recover --git-locks --json', 'treeseed recover --git-locks --execute --json', 'treeseed recover --prune-stale --json', 'treeseed recover --obsolete release-abcd12 --reason "superseded by new staging save"'],
		help: {
			workflowPosition: 'recover',
			longSummary: [
				'Recover lists the active workflow lock plus resumable interrupted runs so humans and agents can decide whether to resume, wait, or repair manually.',
			],
			whenToUse: [
				'Use this before starting a new mutating workflow when you suspect another run may already hold the workspace lock.',
				'Use this after any interrupted recursive save, stage, close, release, or destroy command.',
				'Use `--git-locks` when Git reports an index lock and you need Treeseed to determine whether automatic repair is safe.',
			],
			beforeYouRun: [
				'Run it from the market workspace root or anywhere inside the tenant so the CLI can inspect the correct `.treeseed/workflow` journal directory.',
			],
			outcomes: [
				'Reports the active workflow lock, resumable interrupted runs, stale runs, obsolete runs, Git index lock diagnostics, and the exact `treeseed resume <run-id>` command for resumable runs.',
			],
			automationNotes: [
				'`recover --json` is the supported discovery entrypoint for agents that need to inspect lock state and resumable run ids safely before mutating the workspace.',
				'Use `recover --prune-stale --json` to archive stale journals after the recorded branch or release heads no longer match current state.',
			],
		},
		executionMode: 'handler',
		handlerName: 'recover',
	})],
	[workspaceCommand('status'), command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed workspace:status'],
		executionMode: 'handler',
		handlerName: workspaceCommand('status'),
	})],
	[workspaceCommand('link'), command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed workspace:link'],
		executionMode: 'handler',
		handlerName: workspaceCommand('link'),
	})],
	[workspaceCommand('unlink'), command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed workspace:unlink'],
		executionMode: 'handler',
		handlerName: workspaceCommand('unlink'),
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
			{ name: 'live', flags: '--live', description: 'Include read-only live provider and hosted service checks.', kind: 'boolean' },
			{ name: 'hostedServices', flags: '--hosted-services', description: 'Include config-driven hosted service checks.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed doctor', 'treeseed doctor --live --json', 'treeseed doctor --fix --json'],
		help: {
			workflowPosition: 'validate',
			longSummary: [
				'Doctor diagnoses workflow blockers across tooling, auth, workspace state, and local configuration. It is the command to run when Treeseed feels broken and you want a prioritized explanation of what is wrong.',
			],
			whenToUse: [
				'Use this when other commands are failing or when onboarding a machine and you want a readiness report.',
				'Use `--fix` when you want Treeseed to apply safe local repairs before rerunning diagnostics.',
				'Use `--live` or `--hosted-services` before staging or release when Railway, Cloudflare, and DNS resources should be checked from configuration.',
			],
			outcomes: [
				'Reports readiness issues and what must be fixed immediately.',
				'Optionally applies safe local fixes before re-checking.',
			],
			examples: [
				example('treeseed doctor', 'Run diagnostics only', 'Inspect the current machine and workspace without making repairs.'),
				example('treeseed doctor --live --json', 'Check hosted services', 'Include config-driven hosted service checks in JSON diagnostics.'),
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
	['install', command({
		options: [
			{ name: 'force', flags: '--force', description: 'Repair or reinstall managed tools even when they are already present.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed install', 'trsd install --json', 'treeseed install --force'],
		help: {
			workflowPosition: 'setup',
			longSummary: [
				'Install prepares the local Treeseed toolchain by installing or verifying Treeseed-managed dependencies. It is safe to rerun and uses the same dependency initializer that config runs during bootstrap.',
			],
			whenToUse: [
				'Use this on a new machine before running config, dev, or deployment workflows.',
				'Use `--force` when a managed tool cache looks stale or corrupted.',
			],
			outcomes: [
				'Installs the managed GitHub CLI, verifies npm-backed Treeseed tool dependencies, and installs gh-act when Docker is available.',
				'Reports any missing host prerequisites such as Git without modifying the operating system.',
			],
			examples: [
				example('treeseed install', 'Install managed dependencies', 'Prepare the local Treeseed dependency toolchain.'),
				example('trsd install --json', 'Inspect setup from automation', 'Emit a structured dependency report for scripts or agents.'),
				example('treeseed install --force', 'Repair the managed cache', 'Reinstall managed downloaded tools and extensions.'),
			],
			relatedDetails: [
				related('config', 'Use `config` after install to configure project and provider values.'),
				related('doctor', 'Use `doctor` when install succeeds but workflow readiness still looks wrong.'),
			],
		},
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({
			force: invocation.args.force === true,
		}),
	})],
	['tools', command({
		options: [
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed tools', 'trsd tools --json'],
		help: {
			workflowPosition: 'setup',
			longSummary: [
				'Tools reports the Treeseed-managed executable cache, exact binary paths, invocation mode, and GitHub CLI authentication state without installing or mutating tools.',
			],
			whenToUse: [
				'Use this before shelling out to `gh`, Wrangler, Railway, or Copilot from an agent or script.',
				'Use this when a command claims an executable is missing but `treeseed install` has already prepared the managed tool cache.',
			],
			outcomes: [
				'Reports toolsHome, ghConfigDir, per-tool binaryPath, invocation command, and GitHub auth remediation.',
			],
			examples: [
				example('trsd tools --json', 'Resolve managed paths for automation', 'Emit stable executable paths and auth status for scripts or agents.'),
			],
			relatedDetails: [
				related('install', 'Use `install` when tools are missing or the managed cache needs repair.'),
				related('doctor', 'Use `doctor` when tools exist but workflow readiness is still blocked.'),
			],
		},
		executionMode: 'adapter',
	})],
	['auth:login', command({
		options: [
			{ name: 'host', flags: '--host <id>', description: 'Override the configured remote host id for this login.', kind: 'string' },
				{ name: 'market', flags: '--market <id-or-url>', description: 'Limit catalog lookup to one configured market id or direct API URL. Without this, search/install uses the integrated catalog from all configured catalog markets.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed auth:login'],
		help: {
			longSummary: ['Auth:login authenticates the CLI against the configured Treeseed API so later provider-aware and remote-aware workflows can run without missing-credential failures.'],
			examples: [
				example('treeseed auth:login', 'Log in with the default host', 'Authenticate the CLI against the configured default Treeseed API host.'),
				example('treeseed auth:login --market local', 'Log in to local dev', 'Authenticate against the local Treeseed API at TREESEED_API_BASE_URL or http://127.0.0.1:3000.'),
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
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
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
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'allMarkets', flags: '--all-markets', description: 'Show locally stored identities for all configured markets.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
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
	['secrets:status', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed secrets:status'],
		help: {
			longSummary: ['Secrets:status shows whether the local key agent is running, whether the wrapped machine key exists, and whether the in-memory secret session is currently unlocked.'],
			whenToUse: ['Use this before secret-backed local commands when you need to confirm whether the machine key is already unlocked.'],
			beforeYouRun: ['Decide whether you want the human-readable summary or `--json` for automation.'],
			automationNotes: ['This command is read-only and safe for agents to call before deciding whether an unlock step is required.'],
		},
		executionMode: 'handler',
		handlerName: 'secrets:status',
	})],
	['secrets:unlock', command({
		options: [
			{ name: 'fromEnv', flags: '--from-env', description: 'Unlock from TREESEED_KEY_PASSPHRASE instead of prompting.', kind: 'boolean' },
			{ name: 'createIfMissing', flags: '--create-if-missing', description: 'Create a wrapped machine key when one does not exist yet.', kind: 'boolean' },
			{ name: 'allowMigration', flags: '--allow-migration', description: 'Allow migration from the legacy plaintext machine-key file.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed secrets:unlock', 'treeseed secrets:unlock --from-env'],
		help: {
			longSummary: ['Secrets:unlock starts or reuses the host-local key agent and unlocks the in-memory machine key from an interactive passphrase prompt or the TREESEED_KEY_PASSPHRASE startup env var.'],
			whenToUse: ['Use this before running local dev, config, deployment, or runner commands that need encrypted local secrets.'],
			beforeYouRun: ['Use a TTY for the interactive prompt path, or set TREESEED_KEY_PASSPHRASE before using `--from-env` in backend startup automation.'],
			automationNotes: ['Backend servers should use `--from-env` only during the explicit startup unlock step, not during arbitrary job execution.'],
		},
		executionMode: 'handler',
		handlerName: 'secrets:unlock',
	})],
	['secrets:lock', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed secrets:lock'],
		help: {
			longSummary: ['Secrets:lock clears the in-memory machine key from the host-local key agent.'],
			whenToUse: ['Use this when you want to end the current local secret session before the idle timeout expires.'],
			beforeYouRun: ['No additional setup is required.'],
			automationNotes: ['This command is safe to run in automation when a runner host should explicitly clear local secret access.'],
		},
		executionMode: 'handler',
		handlerName: 'secrets:lock',
	})],
	['secrets:migrate-key', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed secrets:migrate-key'],
		help: {
			longSummary: ['Secrets:migrate-key replaces the legacy plaintext machine-key file with the wrapped passphrase-protected format used by the Treeseed key agent.'],
			whenToUse: ['Use this when status or doctor reports that machine-key migration is still required.'],
			beforeYouRun: ['Run this in a TTY so you can create and confirm the new wrapping passphrase.'],
			automationNotes: ['Prefer this as a one-time operator action rather than an unattended automation step.'],
		},
		executionMode: 'handler',
		handlerName: 'secrets:migrate-key',
	})],
	['secrets:rotate-passphrase', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed secrets:rotate-passphrase'],
		help: {
			longSummary: ['Secrets:rotate-passphrase re-wraps the existing machine key with a newly entered passphrase without changing the underlying machine key.'],
			whenToUse: ['Use this when the local wrapping passphrase should be changed without re-encrypting the stored secret payloads.'],
			beforeYouRun: ['Unlock the current secret session first, then run this in a TTY so you can enter and confirm the new passphrase.'],
			automationNotes: ['Treat passphrase rotation as an operator-controlled maintenance action, not a normal background job.'],
		},
		executionMode: 'handler',
		handlerName: 'secrets:rotate-passphrase',
	})],
	['secrets:rotate-machine-key', command({
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed secrets:rotate-machine-key'],
		help: {
			longSummary: ['Secrets:rotate-machine-key generates a new machine key, re-encrypts stored local secrets, and re-wraps the result with the configured passphrase.'],
			whenToUse: ['Use this when the underlying machine key itself must be rotated, such as after a local secret-hygiene event.'],
			beforeYouRun: ['Unlock the current secret session and make sure TREESEED_KEY_PASSPHRASE is set for the non-interactive re-wrap step.'],
			automationNotes: ['This command mutates local encrypted state and should be run intentionally rather than as part of routine startup automation.'],
		},
		executionMode: 'handler',
		handlerName: 'secrets:rotate-machine-key',
	})],
	['template', command({
		usage: 'treeseed template [list|show|validate] [id]',
		arguments: [
			{ name: 'action', description: 'Template action: list, show, or validate.', required: false },
			{ name: 'id', description: 'Template id for show or validate.', required: false },
		],
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'version', flags: '--version <version>', description: 'Artifact version for market template install.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed template', 'treeseed template list', `treeseed template show ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID}`, 'treeseed template validate'],
		help: {
			longSummary: [
					'Template exposes local starter catalog actions and market-backed search/install actions. Market search/install uses an integrated catalog from central and configured specialized markets, with every result labeled by source market.',
			],
			examples: [
				example('treeseed template', 'Default to the catalog list', 'Show the available starters without specifying an action.'),
				example(`treeseed template show ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID}`, 'Inspect a single starter', 'View the details of one starter template.'),
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
			{ name: 'template', flags: '--template <starter-id>', description: `Select the starter template id to generate. Defaults to ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID}.`, kind: 'string' },
			{ name: 'name', flags: '--name <site-name>', description: 'Override the generated site name.', kind: 'string' },
			{ name: 'slug', flags: '--slug <slug>', description: 'Override the generated package and tenant slug.', kind: 'string' },
			{ name: 'siteUrl', flags: '--site-url <url>', description: 'Set the initial public site URL.', kind: 'string' },
			{ name: 'contactEmail', flags: '--contact-email <email>', description: 'Set the site contact address.', kind: 'string' },
			{ name: 'repo', flags: '--repo <url>', description: 'Set the repository URL.', kind: 'string' },
			{ name: 'discord', flags: '--discord <url>', description: 'Set the Discord/community URL.', kind: 'string' },
			{ name: 'host', flags: '--host <requirement=provider:alias>', description: 'Bind a template launch requirement locally. Repeat for multiple requirements, or use requirement=none for optional hosts.', kind: 'string', repeatable: true },
		],
		examples: [
			`treeseed init docs-site --template ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID} --name "Docs Site" --site-url https://docs.example.com`,
			`treeseed init docs-site --template ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID} --host sourceRepository=github:acme --host publicWeb=cloudflare:managed`,
		],
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
				example(`treeseed init docs-site --template ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID} --name "Docs Site" --site-url https://docs.example.com`, 'Create a starter site', 'Scaffold a new tenant using the default starter and explicit branding metadata.'),
				example(`treeseed init docs-site --template ${TREESEED_DEFAULT_STARTER_TEMPLATE_ID} --host sourceRepository=github:acme --host publicWeb=cloudflare:managed`, 'Bind launch hosts locally', 'Apply host-derived starter config during scaffold without calling Market inventory APIs.'),
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
			{ name: 'mouse', flags: '--mouse', description: 'Opt into mouse capture for the config UI. Keyboard-first terminal behavior remains the default.', kind: 'boolean' },
			{ name: 'environment', flags: '--environment <scope>', description: 'Select all environments or limit configuration to local, staging, or prod. Defaults to all.', kind: 'enum', repeatable: true, values: ['all', 'local', 'staging', 'prod'] },
			{ name: 'sync', flags: '--sync <mode>', description: 'Sync hosted secrets/variables to GitHub, Cloudflare, Railway, or all providers. Defaults to all; GitHub binding changes are applied through reconciler-owned units.', kind: 'enum', values: ['none', 'github', 'cloudflare', 'railway', 'all'] },
			{ name: 'bootstrap', flags: '--bootstrap', description: 'Skip the editor and run platform reconciliation/bootstrap from the currently saved required values.', kind: 'boolean' },
			{ name: 'system', flags: '--system <system>', description: 'Limit bootstrap to a system group. Repeatable. Values: all, github, data, web, api, agents.', kind: 'enum', repeatable: true, values: ['all', 'github', 'data', 'web', 'api', 'agents'] },
			{ name: 'systems', flags: '--systems <systems>', description: 'Comma-separated bootstrap system groups. Values: all, github, data, web, api, agents.', kind: 'string' },
			{ name: 'skipUnavailable', flags: '--skip-unavailable', description: 'Skip selected bootstrap systems whose required provider credentials are not configured.', kind: 'boolean' },
			{ name: 'bootstrapSequential', flags: '--bootstrap-sequential', description: 'Run bootstrap DAG tasks sequentially for ordered debugging logs.', kind: 'boolean' },
			{ name: 'preflight', flags: '--preflight', description: 'Inspect bootstrap verification readiness and planned checks without mutating provider resources.', kind: 'boolean' },
			{ name: 'nonInteractive', flags: '--non-interactive', description: 'Apply resolved values without opening the interactive UI. Required for non-TTY automation unless using an operational mode such as --print-env-only.', kind: 'boolean' },
			{ name: 'installMissingTooling', flags: '--install-missing-tooling', description: 'Install missing config verification tooling such as `gh-act` during the run instead of only reporting it.', kind: 'boolean' },
			{ name: 'printEnv', flags: '--print-env', description: 'Print resolved environment values before remote initialization.', kind: 'boolean' },
			{ name: 'printEnvOnly', flags: '--print-env-only', description: 'Print resolved environment values, check provider connections, and exit without prompting or initializing remote resources.', kind: 'boolean' },
			{ name: 'showSecrets', flags: '--show-secrets', description: 'Print full secret values in environment reports instead of masking them.', kind: 'boolean' },
			{ name: 'rotateMachineKey', flags: '--rotate-machine-key', description: 'Regenerate the local home machine key and re-encrypt stored Treeseed secrets and remote auth sessions.', kind: 'boolean' },
			{ name: 'connectMarket', flags: '--connect-market', description: 'Pair the current local repo to a TreeSeed project and register the hybrid runner connection.', kind: 'boolean' },
			{ name: 'marketBaseUrl', flags: '--market-base-url <url>', description: 'TreeSeed control-plane base URL for --connect-market. Defaults to the active remote host.', kind: 'string' },
			{ name: 'marketTeamId', flags: '--market-team-id <id>', description: 'Team ID to record in the local TreeSeed pairing metadata.', kind: 'string' },
			{ name: 'marketTeamSlug', flags: '--market-team-slug <slug>', description: 'Team slug to record in the local TreeSeed pairing metadata.', kind: 'string' },
			{ name: 'marketProjectId', flags: '--market-project-id <id>', description: 'Project ID to pair with when using --connect-market.', kind: 'string' },
			{ name: 'marketProjectSlug', flags: '--market-project-slug <slug>', description: 'Project slug to record in the local TreeSeed pairing metadata.', kind: 'string' },
			{ name: 'marketProjectApiBaseUrl', flags: '--market-project-api-base-url <url>', description: 'Override the project API base URL recorded on the TreeSeed project connection.', kind: 'string' },
			{ name: 'marketAccessToken', flags: '--market-access-token <token>', description: 'Explicit TreeSeed access token to use for pairing. Prefer an existing remote session when possible.', kind: 'string' },
			{ name: 'rotateRunnerToken', flags: '--rotate-runner-token', description: 'Rotate the project runner credential while pairing the local hybrid repo.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed config', 'treeseed config --full --mouse', 'treeseed config --environment all', 'treeseed config --environment staging --bootstrap', 'treeseed config --environment staging --bootstrap --system web', 'treeseed config --environment staging --bootstrap --preflight', 'treeseed config --environment local --sync none', 'treeseed config --environment local --sync none --non-interactive', 'treeseed config --environment staging --print-env-only --show-secrets', 'treeseed config --rotate-machine-key', 'treeseed config --connect-market --market-project-id kc_proj_123'],
		notes: ['Does not create branch preview deployments. Use `treeseed switch <branch> --preview` for that.'],
		help: {
			workflowPosition: 'configure runtime',
			longSummary: [
				'Config is the runtime foundation command for Treeseed. It resolves local and hosted environment values, captures missing values, runs the startup wizard or full editor for human use, and can synchronize provider-backed secrets and variables.',
				'Use it whenever environment configuration, provider auth, shared defaults, or machine-local secret state need to be inspected or updated.',
			],
			whenToUse: [
				'Use this during first-run setup, after new required environment variables are introduced, or when provider-backed configuration drift must be repaired.',
				'Use the startup wizard for onboarding and the full editor when you need complete per-variable control. Terminal-native copy, selection, and paste are the default interaction model.',
			],
			beforeYouRun: [
				'Decide whether you want human interactive mode, explicit `--non-interactive` application, or machine-readable `--json` output before invoking the command.',
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
				example('treeseed config --full --mouse', 'Opt into mouse capture for the editor', 'Keep the keyboard-first defaults unless you explicitly want click and wheel interaction inside the config UI.'),
				example('treeseed config --environment staging --bootstrap', 'Bootstrap infrastructure from saved config', 'Skip the editor and run reconciliation/bootstrap when the required values are already configured.'),
				example('treeseed config --environment staging --bootstrap --system web', 'Bootstrap only the hosted hub', 'Provision data and web systems while leaving optional API and agent Railway services alone.'),
				example('treeseed config --environment staging --bootstrap --preflight', 'Inspect bootstrap verification readiness', 'Show the resolved units, verification capabilities, and planned reconcile actions without mutating provider resources.'),
				example('treeseed config --environment local --sync none', 'Edit local values without provider sync', 'Limit the session to local values and avoid hosted synchronization while iterating locally.'),
				example('treeseed config --environment local --sync none --non-interactive', 'Apply deterministic local config in automation', 'Use the resolved current and suggested values without opening the interactive UI.'),
				example('treeseed config --environment staging --print-env-only --show-secrets', 'Inspect a resolved environment report', 'Print the resolved staging environment with full secret visibility and exit.'),
				example('treeseed config --rotate-machine-key', 'Rotate the local secret encryption key', 'Regenerate the machine key and re-encrypt locally stored Treeseed secrets.'),
				example('treeseed config --connect-market --market-project-id kc_proj_123', 'Pair a hybrid repo to TreeSeed', 'Register the current local repo as the hybrid runner connection for an existing TreeSeed project.'),
			],
			optionDetails: [
				detail('--full', 'Enter the advanced editor directly instead of the startup wizard.'),
				detail('--mouse', 'Opt into terminal mouse capture for clicking, scrolling, and focus changes inside the config UI.'),
				detail('--environment <scope>', 'Filter configuration to `all`, `local`, `staging`, or `prod`.'),
				detail('--sync <mode>', 'Choose which provider surfaces should receive synchronized values after local updates are applied.'),
				detail('--bootstrap', 'Skip the editor and run the reconcile/bootstrap path from the values already stored in machine config.'),
				detail('--system <system>', 'Limit bootstrap to a stable system group. Repeat it to select multiple groups.'),
				detail('--systems <systems>', 'Comma-separated form of --system for automation.'),
				detail('--skip-unavailable', 'Skip selected systems whose provider credentials are missing instead of failing the run.'),
				detail('--bootstrap-sequential', 'Run bootstrap DAG tasks one at a time to preserve log order for debugging or LLM review.'),
				detail('--preflight', 'When combined with `--bootstrap`, inspect verification readiness and planned reconcile actions without mutating provider resources.'),
				detail('--non-interactive', 'Apply resolved values without opening the interactive editor. Use this for automation when you do not want `--json` output.'),
				detail('--install-missing-tooling', 'Allow config to install missing verification helpers such as the GitHub `gh-act` extension instead of only reporting them.'),
				detail('--print-env', 'Print the resolved environment values before remote initialization continues.'),
				detail('--print-env-only', 'Print the environment report and exit without interactive editing or remote initialization.'),
				detail('--rotate-machine-key', 'Rotate the local machine key used for encrypted Treeseed secret storage.'),
				detail('--connect-market', 'Pair the current repo to a TreeSeed project and store the resulting market connection metadata locally.'),
			],
			automationNotes: [
				'Use `--json` for machine-readable automation, or `--non-interactive` when you want deterministic application without interactive UI.',
				'`--bootstrap`, `--bootstrap --preflight`, `--print-env-only`, `--rotate-machine-key`, and `--connect-market` are operational paths that bypass the interactive UI.',
				'Config reports missing tooling by default. Use `--install-missing-tooling` when you want the command to attempt installation.',
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
		usage: 'treeseed release --major|--minor|--patch|--repair-version-line',
		options: [
			{ name: 'major', flags: '--major', description: 'Bump to the next major version.', kind: 'boolean' },
			{ name: 'minor', flags: '--minor', description: 'Bump to the next minor version.', kind: 'boolean' },
			{ name: 'patch', flags: '--patch', description: 'Bump to the next patch version.', kind: 'boolean' },
			{ name: 'repairVersionLine', flags: '--repair-version-line', description: 'Repair public package major.minor drift without enforcing patch parity.', kind: 'boolean' },
			{ name: 'targetVersionLine', flags: '--target-version-line <major.minor>', description: 'Target release line for --repair-version-line, for example 0.10.', kind: 'string' },
			{ name: 'ciMode', flags: '--ci <mode>', description: 'Control hosted GitHub Actions waits.', kind: 'enum', values: ['auto', 'hosted', 'off'] },
			{ name: 'workspaceLinks', flags: '--workspace-links <mode>', description: 'Control local workspace package links.', kind: 'enum', values: ['auto', 'off'] },
			{ name: 'verifyDeployedResources', flags: '--verify-deployed-resources', description: 'Force production deployment checks to verify provider resources before release returns.', kind: 'boolean' },
			{ name: 'fresh', flags: '--fresh', description: 'Start a new release instead of auto-resuming stale failed release runs.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Compute the recursive release plan without mutating any repo.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed release --patch', 'treeseed release --minor --verify-deployed-resources', 'treeseed release --repair-version-line --target-version-line 0.10 --plan', 'treeseed release --patch --fresh'],
		notes: ['Requires exactly one bump flag unless --repair-version-line is used.'],
		help: {
			workflowPosition: 'promote to production',
			longSummary: [
				'Release promotes the staging state to production while applying a version bump. It is the forward promotion command once staging reflects the exact state you intend to publish.',
			],
			whenToUse: [
				'Use this only when staging is the approved source for production promotion.',
				'Choose exactly one bump flag so the release version reflects the intended change size, or use --repair-version-line to repair package line drift.',
				'Use `--verify-deployed-resources` when production provider resources must be checked before the release returns.',
			],
			beforeYouRun: [
				'Confirm staging is in the state you want to promote.',
				'Run `treeseed release-candidate --strict` first if you want to inspect the full proof before release; release will require strict proof for the exact staging state.',
				'Choose one of `--major`, `--minor`, `--patch`, or `--repair-version-line` before running the command.',
			],
			outcomes: [
				'Promotes the release forward and records the version bump.',
				'Returns release metadata in JSON mode when requested.',
			],
			examples: [
				example('treeseed release --patch', 'Patch release', 'Promote staging to production with the next patch version.'),
				example('treeseed release --minor --verify-deployed-resources', 'Minor release with hosted checks', 'Promote staging with the next minor version bump and verify production provider resources.'),
				example('treeseed release --repair-version-line --target-version-line 0.10 --json', 'Repair package line drift', 'Publish only packages below the selected public package release line.'),
				example('treeseed release --patch --json', 'Automate release tracking', 'Emit structured release output for tooling that records deployments and version changes.'),
			],
			warnings: [
				'Exactly one bump flag is required unless --repair-version-line is used.',
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
		usage: 'treeseed destroy --environment <local|staging|prod> [--plan|--dry-run] [--delete-data] [--sweep-treeseed] [--force] [--skip-confirmation] [--confirm <slug>] [--remove-build-artifacts]',
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Select the persistent environment to destroy.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'plan', flags: '--plan', description: 'Compute the destroy plan without mutating the environment.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Alias for --plan.', kind: 'boolean' },
			{ name: 'deleteData', flags: '--delete-data', description: 'Also delete data repositories such as PostgreSQL, D1, and R2 for the target environment.', kind: 'boolean' },
			{ name: 'sweepTreeseed', flags: '--sweep-treeseed', description: 'Sweep all TreeSeed-owned Cloudflare and Railway resources across persistent environments. Requires careful provider verification.', kind: 'boolean' },
			{ name: 'force', flags: '--force', description: 'Force worker deletion when supported.', kind: 'boolean' },
			{ name: 'skipConfirmation', flags: '--skip-confirmation', description: 'Skip the interactive confirmation prompt.', kind: 'boolean' },
			{ name: 'confirm', flags: '--confirm <slug>', description: 'Provide the expected slug confirmation non-interactively.', kind: 'string' },
			{ name: 'removeBuildArtifacts', flags: '--remove-build-artifacts', description: 'Also remove local build artifacts after destroy.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed destroy --environment staging --delete-data --plan', 'treeseed destroy --environment staging --delete-data --sweep-treeseed --force --confirm example --skip-confirmation'],
		notes: ['Only for persistent environments. Task cleanup belongs to treeseed close.', 'This command is destructive and requires explicit confirmation.'],
		help: {
			workflowPosition: 'tear down environment',
			longSummary: [
				'Destroy tears down a persistent environment and, optionally, related local build artifacts. It is the destructive environment cleanup command and should be treated as an explicit operator workflow.',
			],
			whenToUse: [
				'Use this when a persistent environment should be intentionally removed rather than rolled back or updated.',
				'Use `--plan` first when you want to inspect the destroy plan without committing to it.',
				'Use `--delete-data` only when PostgreSQL, D1, and R2 data repositories should be removed instead of preserved.',
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
				example('treeseed destroy --environment staging --delete-data --plan', 'Preview the full destroy plan', 'Inspect what would be removed from staging, including data repositories, without actually performing the destroy.'),
				example('treeseed destroy --environment prod --delete-data --confirm example --skip-confirmation', 'Run a deliberate non-interactive destroy', 'Provide the expected slug explicitly when operating in a scripted or no-prompt environment.'),
				example('treeseed destroy --environment local --delete-data --remove-build-artifacts', 'Remove a local environment and its artifacts', 'Destroy the local environment and also delete local runtime data and build outputs.'),
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
		options: DEV_RUNTIME_OPTIONS,
		arguments: [{ name: 'subcommand', description: 'Optional managed instance action: start, status, logs, stop, or restart.', required: false }],
		examples: ['treeseed dev', 'treeseed dev start', 'treeseed dev status --all --json', 'treeseed dev logs', 'treeseed dev stop', 'treeseed dev --web-runtime local --plan --json'],
		help: {
			longSummary: [
				'Dev starts or manages the local Treeseed Market web/API/runtime services.',
				'Without a subcommand, dev runs as the existing foreground supervisor.',
				'Capacity provider lifecycle is package-owned and runs through `treeseed capacity ...`, not through `treeseed dev`.',
			],
			beforeYouRun: [
				'Run from the tenant or workspace root you want to develop.',
				'From the Market repo root, dev automatically starts the local API, managed local PostgreSQL, and Treeseed operations runner alongside the web UI.',
				'Use `dev start` for worktree-scoped background instance management that AI agents can discover and stop later.',
				'Use `--plan --json` when you want to inspect fixed web/API/runner commands, setup steps, readiness checks, watched paths, and restart policy without starting services.',
				'Use `--reset` when you want a fresh local D1 database, Treeseed PostgreSQL state, Mailpit inbox, generated worker bundle, and Wrangler temp output without deleting configuration.',
				'Dev prints the local web URL after readiness; it does not open a browser unless you pass `--open on` or `--open auto`.',
				'Keep the foreground process running while you test. Press Ctrl+C to stop the supervised stack and free the local ports.',
			],
			examples: [
				example('treeseed dev', 'Start local Market development', 'Run web, API, managed PostgreSQL setup, and the Treeseed operations runner locally.'),
				example('treeseed dev start', 'Start a managed worktree instance', 'Launch the same dev runtime detached, write worktree-local PID/log/state files, and return after readiness.'),
				example('treeseed dev status --all --json', 'Inspect all worktree instances', 'List managed dev instances discovered through the repository-family index.'),
				example('treeseed dev logs', 'Show managed dev logs', 'Print the current worktree managed dev log file.'),
				example('treeseed dev stop', 'Stop managed dev', 'Stop only the current worktree managed dev instance.'),
				example('treeseed dev --reset', 'Start from a fresh local runtime', 'Clear disposable local dev state, rerun setup and database migrations, then start the dev supervisor.'),
				example('treeseed dev --reset --plan --json', 'Inspect reset actions', 'Emit the reset, setup, readiness, command, and watch plan without deleting local state or starting services.'),
				example('treeseed dev --plan --json', 'Inspect the runtime plan', 'Emit a structured plan with setup steps, commands, ports, URLs, readiness checks, and watch entries.'),
				example('treeseed dev --web-runtime local --plan --json', 'Inspect local web runtime', 'Plan fixed web/API/runner startup using the local Astro web runtime.'),
				example('treeseed dev --port 4322', 'Change the web port', 'Start the fixed web/API/runner runtime with the Astro UI on a specific port.'),
				example('treeseed dev --open on', 'Open the browser explicitly', 'Start the integrated runtime and launch the local web URL after readiness.'),
				example('trsd dev', 'Use the short alias', 'Start the same local runtime through the shorter entrypoint.'),
				example('treeseed dev --json', 'Stream dev events', 'Emit newline-delimited events while the long-running dev process supervises local services.'),
			],
			outcomes: [
				'Starts fixed local web/API/runner surfaces, waits for readiness, prints the local URL, and then remains attached as the live supervisor.',
				'Restarts required crashed surfaces with capped exponential backoff and keeps setup/readiness failures alive for retry.',
				'Stops watchers first and then terminates service process groups when the foreground command exits.',
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
	['preflight', command({
		options: [
			{ name: 'launch', flags: '--launch', description: 'Validate managed TreeSeed launch prerequisites, provider auth, and required live configuration.', kind: 'boolean' },
		],
		examples: ['treeseed preflight', 'treeseed preflight --launch'],
		help: {
			longSummary: ['Preflight checks local prerequisites and authentication state before heavier workflows run.'],
			examples: [
				example('treeseed preflight', 'Run the preflight checklist', 'Inspect local prerequisites and auth readiness.'),
				example('treeseed preflight --launch', 'Validate live launch readiness', 'Check managed TreeSeed launch prerequisites before creating live GitHub, Cloudflare, and Railway resources.'),
				example('trsd preflight', 'Use the short alias', 'Run the same readiness check via the short entrypoint.'),
				example('treeseed preflight && treeseed dev', 'Validate before starting local runtime', 'Confirm readiness before launching the integrated dev surface.'),
			],
		},
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({
			launch: invocation.args.launch === true,
		}),
	})],
	['auth:check', command({ examples: ['treeseed auth:check'], executionMode: 'adapter', buildAdapterInput: () => ({ requireAuth: true }) })],
	['test:e2e', command({ examples: ['treeseed test:e2e'], executionMode: 'adapter' })],
	['test:e2e:local', command({ examples: ['treeseed test:e2e:local'], executionMode: 'adapter' })],
	['test:e2e:staging', command({ examples: ['treeseed test:e2e:staging'], executionMode: 'adapter' })],
	['test:e2e:full', command({ examples: ['treeseed test:e2e:full'], executionMode: 'adapter' })],
	['test:release', command({ examples: ['treeseed test:release'], executionMode: 'adapter' })],
	['test:release:full', command({ examples: ['treeseed test:release:full', 'treeseed release:verify'], executionMode: 'adapter' })],
	['release:publish:changed', command({ examples: ['treeseed release:publish:changed'], executionMode: 'adapter' })],
	['astro', command({ examples: ['treeseed astro -- --help'], executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
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

const DEV_MANAGED_OPERATION_SPECS: TreeseedOperationSpec[] = [
	devManagedHelpCommand('start', {
		summary: 'Start a detached worktree-scoped dev instance.',
		description: 'Start launches the same Market web/API/runner runtime as foreground `dev`, but detaches it, writes worktree-local instance state, captures logs, waits for readiness, and returns a summary.',
		usage: 'treeseed dev start [--web-runtime local|provider|auto] [--port <port>] [--api-port <port>] [--force] [--force-conflicts] [--json]',
		options: DEV_START_OPTIONS,
		whenToUse: [
			'Use this when you want the local Market runtime to keep running after the shell command exits.',
			'Use it for AI-agent workflows where later commands need discoverable PID, port, URL, and log state.',
		],
		beforeYouRun: [
			'Run from the worktree that should own the managed instance.',
			'Use `--web-runtime local` for fast Astro hot reload.',
			'Use `--force` to replace only the current worktree instance. Use `--force-conflicts` only when you intentionally want to stop sibling worktree port owners.',
		],
		outcomes: [
			'Writes `.treeseed/dev/instances/web-api.json`, `.treeseed/dev/pids/web-api.pid`, and `.treeseed/logs/dev-web-api.jsonl` in the current worktree.',
			'Returns after readiness with URLs, ports, PID, process group, log path, and ready-check state.',
		],
		examples: [
			example('treeseed dev start --web-runtime local --force', 'Start the current worktree instance', 'Launch the managed background runtime with local web hot reload and replace any stale current-worktree owner.'),
			example('treeseed dev start --port 4322 --api-port 3002 --json', 'Start on explicit ports', 'Pin web and API ports and emit a structured instance summary.'),
			example('trsd dev start --web-runtime local', 'Use the short alias', 'Start the same managed runtime through the shorter entrypoint.'),
		],
	}),
	devManagedHelpCommand('status', {
		summary: 'Inspect managed dev instance state.',
		description: 'Status reads worktree-local managed dev state, checks process and readiness health, repairs stale records opportunistically, and can discover sibling worktree instances through the repository-family index.',
		usage: 'treeseed dev status [--all] [--json]',
		options: DEV_STATUS_OPTIONS,
		whenToUse: [
			'Use this before starting a new managed instance to see whether one is already running.',
			'Use `--all` when multiple worktrees or AI agents may be running sibling instances for the same repository family.',
		],
		beforeYouRun: [
			'Run from the worktree you want to inspect.',
			'Use `--json` for automation that needs the exact status, PID, ports, URLs, stale reason, or sibling conflicts.',
		],
		outcomes: [
			'Prints ready, starting, degraded, stopped, or stale state for the current worktree instance.',
			'With `--all`, includes instances discovered from sibling worktrees through the shared repository-family index.',
		],
		examples: [
			example('treeseed dev status', 'Inspect current worktree', 'Show the managed instance state for the current worktree.'),
			example('treeseed dev status --all', 'Inspect sibling worktrees', 'List managed instances discoverable across the repository family.'),
			example('treeseed dev status --json', 'Read status programmatically', 'Emit machine-readable instance state for agents or scripts.'),
		],
	}),
	devManagedHelpCommand('logs', {
		summary: 'Read managed dev logs.',
		description: 'Logs prints the current worktree managed dev log in human-readable form, rendering structured dev events as concise text and optionally following the stable log file.',
		usage: 'treeseed dev logs [--follow] [--json]',
		options: DEV_LOGS_OPTIONS,
		whenToUse: [
			'Use this when `dev status` reports stale, degraded, or stopped and you need to see what happened.',
			'Use `--follow` while iterating locally to watch the background runtime without reattaching to the supervisor process.',
		],
		beforeYouRun: [
			'Run from the worktree that owns the managed instance.',
			'Default human output shows a recent, readable tail. Use the reported log path if you need the full historical file.',
		],
		outcomes: [
			'Prints the current managed log tail from `.treeseed/logs/dev-web-api.jsonl`.',
			'With `--follow`, continues streaming appended log lines until interrupted.',
		],
		examples: [
			example('treeseed dev logs', 'Show recent managed logs', 'Print the current worktree managed dev log tail in human-readable form.'),
			example('treeseed dev logs --follow', 'Follow background runtime logs', 'Stream appended log entries while the managed instance runs.'),
			example('treeseed dev status --json', 'Find the log path', 'Use status when automation needs the authoritative log file location.'),
		],
	}),
	devManagedHelpCommand('stop', {
		summary: 'Stop managed dev instances.',
		description: 'Stop terminates the current worktree managed dev process group and leaves sibling worktree instances alone unless `--all` is explicitly provided.',
		usage: 'treeseed dev stop [--all] [--json]',
		options: DEV_STOP_OPTIONS,
		whenToUse: [
			'Use this when you are done with the current worktree background runtime.',
			'Use `--all` only when intentionally cleaning up every discoverable managed instance in the repository family.',
		],
		beforeYouRun: [
			'Run from the worktree whose instance should be stopped.',
			'Prefer `dev status --all` first when several agents may be working in sibling worktrees.',
		],
		outcomes: [
			'Stops only the owned process group for the current worktree by default.',
			'Marks stopped or stale records so later `dev start` and `dev status` calls see accurate state.',
		],
		warnings: [
			'`--all` can interrupt sibling worktree sessions owned by other humans or agents.',
		],
		examples: [
			example('treeseed dev stop', 'Stop current worktree instance', 'Terminate only the current managed dev process group.'),
			example('treeseed dev stop --all', 'Stop repository-family instances', 'Stop all discoverable managed instances for the repository family.'),
			example('treeseed dev stop --json', 'Stop from automation', 'Emit a structured stop summary.'),
		],
	}),
	devManagedHelpCommand('restart', {
		summary: 'Restart a managed dev instance.',
		description: 'Restart stops the current worktree managed dev instance, then starts it again with the same managed-start semantics, state files, log path, readiness checks, and port ownership rules.',
		usage: 'treeseed dev restart [--web-runtime local|provider|auto] [--port <port>] [--api-port <port>] [--force] [--force-conflicts] [--json]',
		options: DEV_START_OPTIONS,
		whenToUse: [
			'Use this after changing runtime configuration, package links, or local service state that needs a fresh supervisor.',
			'Use it when the managed instance is degraded and a clean stop/start is preferable to inspecting every child process manually.',
		],
		beforeYouRun: [
			'Run from the worktree that owns the managed instance.',
			'Pass the same runtime options you would use with `dev start` when you want to change ports or web runtime mode during restart.',
		],
		outcomes: [
			'Stops the current worktree managed instance and starts a new one.',
			'Returns the new PID, process group, ports, URLs, log path, and readiness result.',
		],
		examples: [
			example('treeseed dev restart --web-runtime local --force', 'Restart local hot-reload runtime', 'Replace the current worktree managed instance and wait for readiness.'),
			example('treeseed dev restart --port 4322 --api-port 3002 --json', 'Restart on new ports', 'Restart with explicit web/API ports and emit a structured summary.'),
			example('trsd dev restart', 'Use the short alias', 'Restart through the shorter entrypoint.'),
		],
	}),
];

const CLI_ONLY_OPERATION_SPECS: TreeseedOperationSpec[] = [
	...DEV_MANAGED_OPERATION_SPECS,
	{
		id: 'scene',
		name: 'scene',
		aliases: [],
		group: 'Validation',
		summary: 'Inspect the Treeseed scene workflow testing and video platform.',
		description: 'Reports readiness for, validates, plans, and runs the manifest-driven acceptance test harness and demo/training video generator.',
		provider: 'default',
		related: ['dev', 'seed', 'ready', 'test:e2e'],
		usage: 'treeseed scene [status] [--json]\n       treeseed scene validate <scene.yaml> [--json]\n       treeseed scene plan <scene.yaml> [--environment local|staging|prod] [--json]\n       treeseed scene run <scene.yaml> [--environment local|staging|prod] [--record] [--mode acceptance|demo|training|record-only] [--device desktop|tablet|mobile|all] [--json]\n       treeseed scene visual-audit <scene.yaml> [--environment local|staging|prod] [--roles anonymous,owner,admin,member] [--device desktop|tablet|mobile|all] [--path-root /app,/auth,/market] [--path /app/**] [--exclude-path **/delete] [--full-page] [--fresh-dev] [--review|--no-review] [--review-detail summary|standard|full] [--max-findings <n>] [--json]\n       treeseed scene inspect <run-id-or-path> [--step <step-id>] [--json]\n       treeseed scene resume <run-id-or-path> --from-checkpoint <checkpoint-id> [--json]\n       treeseed scene render <scene.yaml> --from <run-id-or-path> [--renderer remotion] [--format mp4] [--mode demo|training|failure-review|chapter|diagram-only] [--device <profile>] [--composition <id>] [--chapter <chapter-id>] [--output <path>] [--json]\n       treeseed scene training <scene.yaml> --from <run-id-or-path> [--format json|markdown|vtt|srt] [--json]\n       treeseed scene evidence <scene.yaml> --from <run-id-or-path> [--target local|ci|release] [--bundle metadata-only|sanitized] [--json]\n       treeseed scene publish <scene.yaml> --from <run-id-or-path> [--target local|release] [--redaction-policy <path>] [--json]\n       treeseed scene publish-plan <scene.yaml> --from <run-id-or-path> [--target docs,training,release-evidence,artifact-store] [--json]\n       treeseed scene export <scene.yaml> --from <run-id-or-path> [--target docs,training,release-evidence,artifact-store] [--json]',
		arguments: [
			{ name: 'action', description: 'Scene action. Use status, validate, plan, run, visual-audit, inspect, resume, render, training, evidence, publish, publish-plan, or export.', required: false },
			{ name: 'scene', description: 'Scene manifest path or bare scene id under scenes/.', required: false },
		],
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Environment to select for scene planning or execution.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'record', flags: '--record', description: 'Record Playwright video even when the scene artifact settings do not request video.', kind: 'boolean' },
			{ name: 'mode', flags: '--mode <mode>', description: 'Override run mode for scene run, or render mode for scene render.', kind: 'string' },
			{ name: 'device', flags: '--device <profile|all>', description: 'Run or render a scene with a named device profile such as desktop, tablet, mobile, or all profiles for a device matrix run.', kind: 'string' },
			{ name: 'roles', flags: '--roles <roles>', description: 'Comma-separated visual audit roles such as anonymous, owner, admin, member.', kind: 'string' },
			{ name: 'pathRoot', flags: '--path-root <roots>', description: 'Comma-separated visual audit path roots such as /app,/auth,/market.', kind: 'string' },
			{ name: 'path', flags: '--path <globs>', description: 'Comma-separated or repeatable visual audit route include globs such as /app/projects/** or **/settings.', kind: 'string', repeatable: true },
			{ name: 'excludePath', flags: '--exclude-path <globs>', description: 'Comma-separated or repeatable visual audit route exclude globs such as **/delete or /auth/callback/**.', kind: 'string', repeatable: true },
			{ name: 'fullPage', flags: '--full-page', description: 'Also capture full-page screenshots during visual audit for debugging.', kind: 'boolean' },
			{ name: 'freshDev', flags: '--fresh-dev', description: 'Restart the local managed dev instance before visual audit to avoid stale Vite/module graph failures.', kind: 'boolean' },
			{ name: 'review', flags: '--review', description: 'Generate deterministic visual audit findings, contact sheets, and an agent repair brief.', kind: 'boolean' },
			{ name: 'noReview', flags: '--no-review', description: 'Capture screenshots only and skip visual audit review outputs.', kind: 'boolean' },
			{ name: 'reviewDetail', flags: '--review-detail <detail>', description: 'Visual audit review detail level: summary, standard, or full.', kind: 'string' },
			{ name: 'maxFindings', flags: '--max-findings <n>', description: 'Maximum number of detailed visual audit findings to include.', kind: 'string' },
			{ name: 'step', flags: '--step <step-id>', description: 'Select a single step when inspecting a scene run.', kind: 'string' },
			{ name: 'fromCheckpoint', flags: '--from-checkpoint <checkpoint-id>', description: 'Resume a scene run from a resumable checkpoint.', kind: 'string' },
			{ name: 'from', flags: '--from <run-id-or-path>', description: 'Source scene run id or artifact path for render-only video, training output, evidence generation, evidence publishing, publish planning, or local export.', kind: 'string' },
			{ name: 'target', flags: '--target <target>', description: 'Evidence target, publish target, or comma-separated Phase 11 publication targets: docs, training, release-evidence, artifact-store.', kind: 'string' },
			{ name: 'bundle', flags: '--bundle <policy>', description: 'Evidence bundle policy for scene evidence generation.', kind: 'enum', values: ['metadata-only', 'sanitized'] },
			{ name: 'redactionPolicy', flags: '--redaction-policy <path>', description: 'JSON or YAML redaction policy for scene evidence publishing.', kind: 'string' },
			{ name: 'renderer', flags: '--renderer <renderer>', description: 'Renderer plugin to use for scene render. Phase 11 keeps Remotion adapter-hosted and replaceable.', kind: 'string' },
			{ name: 'format', flags: '--format <format>', description: 'Rendered video format for render, or training output format for scene training.', kind: 'string' },
			{ name: 'composition', flags: '--composition <id>', description: 'Remotion composition id to render.', kind: 'string' },
			{ name: 'chapter', flags: '--chapter <chapter-id>', description: 'Render only one chapter from the source scene run.', kind: 'string' },
			{ name: 'output', flags: '--output <path>', description: 'Output path for the rendered video.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed scene',
			'trsd scene status --json',
			'trsd scene validate scenes/market-project-deploy-demo.yaml --json',
			'trsd scene plan market-project-deploy-demo --environment local --json',
			'trsd scene run market-project-deploy-demo --environment local --record --json',
			'trsd scene run market-project-deploy-demo --environment local --record --device desktop --json',
			'trsd scene run market-project-deploy-demo --environment local --record --device tablet --json',
			'trsd scene run market-project-deploy-demo --environment local --record --device mobile --json',
			'trsd scene run market-project-deploy-demo --environment local --record --device all --json',
			'trsd scene visual-audit scenes/site-visual-audit.yaml --environment local --roles anonymous,owner,admin,member --device all --json',
			'trsd scene visual-audit scenes/site-visual-audit.yaml --environment local --fresh-dev --roles anonymous,owner,admin,member --device all --review-detail full --json',
			'trsd scene visual-audit scenes/site-visual-audit.yaml --environment local --roles owner --device desktop --path-root /app --review-detail full --json',
			'trsd scene visual-audit scenes/site-visual-audit.yaml --environment local --roles owner --device mobile --path /app/projects/** --exclude-path **/delete --review-detail full --json',
			'trsd scene visual-audit scenes/site-visual-audit.yaml --environment local --roles anonymous --device all --no-review --json',
			'trsd scene inspect .treeseed/scenes/runs/market-project-deploy-demo/20260614T120000Z-run123 --step queue-staging-deploy --json',
			'trsd scene resume .treeseed/scenes/runs/market-project-deploy-demo/20260614T120000Z-run123 --from-checkpoint open-projects --json',
			'trsd scene render market-project-deploy-demo --from 20260614T120000Z-run123 --renderer remotion --format mp4 --json',
			'trsd scene render market-project-deploy-demo --from 20260614T120000Z-run123 --device desktop --renderer remotion --format mp4 --json',
			'trsd scene render market-project-deploy-demo --from 20260614T120000Z-run123 --mode failure-review --json',
			'trsd scene render market-project-deploy-demo --from 20260614T120000Z-run123 --mode diagram-only --json',
			'trsd scene training market-project-deploy-demo --from 20260614T120000Z-run123 --format vtt --json',
			'trsd scene evidence market-project-deploy-demo --from 20260614T120000Z-run123 --target ci --bundle sanitized --json',
			'trsd scene publish market-project-deploy-demo --from 20260614T120000Z-run123 --target local --json',
			'trsd scene publish-plan market-project-deploy-demo --from 20260614T120000Z-run123 --target docs,training,release-evidence --json',
			'trsd scene export market-project-deploy-demo --from 20260614T120000Z-run123 --target docs,training --json',
		],
		help: {
			workflowPosition: 'validate',
			longSummary: [
				'Scene is the command surface for the central TreeSeed acceptance test harness and demo / educational video generator.',
				'Phase 11 validates YAML scene manifests, compiles deterministic plans with plugin diagnostics, prepares Treeseed environments, runs Playwright workflows with debugging artifacts, supports long workflow checkpoints, inspect, resume, renders Remotion videos from existing evidence, renders typed animated diagrams, generates deterministic training outputs, writes evidence manifests plus sanitized bundles, publishes redacted local/release evidence bundles, and produces publication plans plus local exports from those redacted bundles.',
			],
			whenToUse: [
				'Use this command to verify that the installed Treeseed CLI and SDK expose the scene platform foundation.',
				'Use validate and plan before browser execution when scene contracts are still being authored.',
				'Use run for browser workflows that need Treeseed setup, trace, screenshot, console, network, timeline, run JSON, Markdown report artifacts, progress events, and checkpoints.',
				'Use `--device desktop`, `--device tablet`, `--device mobile`, or `--device all` to produce separate walkthroughs for different interfaces from the same scene.',
				'Use inspect and resume when a long scene fails late or needs to continue from a durable checkpoint.',
				'Use render to turn a previous run into a demo, training, chapter, failure-review, or diagram-only MP4 without rerunning the browser workflow.',
				'Use training to generate captions, transcripts, narration scripts, glossary artifacts, and chapter clip manifests from existing scene evidence without AI or TTS.',
				'Use evidence to generate a CI- or release-ready manifest and sanitized local bundle from existing run artifacts.',
				'Use publish to create a deny-by-default redacted local or release evidence bundle without external publication.',
				'Use publish-plan to review docs, training, release-evidence, and artifact-store publication intent without external mutation.',
				'Use export to copy already-redacted publish artifacts into local docs, training, and release-evidence export folders.',
				'Use `--json` when an agent, CI check, or future workflow needs stable capability output.',
			],
			beforeYouRun: [
				'No Treeseed project is required for Phase 0 status because the command reports installed platform capability only.',
			],
			outcomes: [
				'Prints scene platform status, validates manifests, emits deterministic plugin-aware plan reports, runs Playwright workflows, inspects run artifacts, resumes from checkpoints, renders Remotion MP4s, generates training artifacts, writes evidence manifests and sanitized bundles, publishes redacted evidence bundles, or creates Phase 11 publication plans and local exports.',
				'Can start managed local dev and apply seeds only when explicitly requested by the scene manifest; render, training, evidence, publish, publish-plan, and export are downstream of existing artifacts and do not perform browser execution, interactive auth, dynamic plugin discovery, or provider mutation.',
			],
			automationNotes: [
				'Run and resume emit newline-delimited JSON progress events followed by one final JSON report when `--json` is selected.',
				'The status JSON report includes phase, status, commandSurface, sdkExports, capabilities, deferredDependencies, and nextPhase.',
				'Unsupported runtime actions and assertions fail clearly with phase-specific diagnostics.',
				'Render falls back to screenshot slideshow output when a source run has screenshots but no Playwright video.',
				'Typed diagrams are validated by the SDK and rendered downstream from existing scene evidence; rendering still does not rerun workflows.',
				'Evidence publishing writes local and release-target redacted bundles only; it does not mutate external providers or publish to remote stores.',
				'Phase 11 publication plans write reconciliation intent records with action `plan-only`; remote publication apply is deferred.',
			],
			relatedDetails: [
				related('dev', 'Scene runs reuse managed dev instance discovery and startup for local workflow tests.'),
				related('seed', 'Scene setup uses seed validation and explicit apply paths for deterministic data.'),
				related('ready', 'Scene setup reuses readiness checks before browser execution.'),
			],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'scene',
	},
	{
		id: 'seed.plan',
		name: 'seed',
		aliases: [],
		group: 'Validation',
		summary: 'Validate and plan declarative Treeseed environment seeds.',
		description: 'Load a seed manifest from seeds/<name>.yaml, validate references and environment targeting, produce a deterministic plan, apply governed seeds through the market store/API, or export a team portfolio to YAML.',
		provider: 'default',
		related: ['status', 'config', 'capacity', 'projects'],
		usage: 'treeseed seed <name> [--environments local,staging,prod] [--plan|--validate|--apply] [--json]\n       treeseed seed export <name> --team <team> [--output <path>] [--json]',
		arguments: [{ name: 'name', description: 'Seed manifest name under the project seeds directory, or `export <name>` for portfolio export.', required: true }],
		options: [
			{ name: 'environments', flags: '--environments <list>', description: 'Comma-separated environments to select from the manifest.', kind: 'string' },
			{ name: 'plan', flags: '--plan', description: 'Generate a deterministic plan without applying it. This is the Phase 1 default.', kind: 'boolean' },
			{ name: 'validate', flags: '--validate', description: 'Validate the manifest and selected environments without printing plan actions.', kind: 'boolean' },
			{ name: 'apply', flags: '--apply', description: 'Apply local seeds directly or governed staging/production seeds through the API.', kind: 'boolean' },
			{ name: 'market', flags: '--market <market>', description: 'Market profile or URL for staging and production seed operations.', kind: 'string' },
			{ name: 'host', flags: '--host <host>', description: 'Compatibility alias for --market.', kind: 'string' },
			{ name: 'approvalRequest', flags: '--approval-request <id>', description: 'Approved production seed apply request id.', kind: 'string' },
			{ name: 'team', flags: '--team <team>', description: 'Team slug, name, or id for seed export.', kind: 'string' },
			{ name: 'output', flags: '--output <path>', description: 'Write exported seed YAML to this path.', kind: 'string' },
			{ name: 'includePrivate', flags: '--include-private', description: 'Include private catalog products in seed export when authorized.', kind: 'boolean' },
			{ name: 'includeArtifacts', flags: '--include-artifacts', description: 'Include catalog artifact version references in seed export.', kind: 'boolean' },
			{ name: 'yes', flags: '--yes', description: 'Future-compatible non-interactive confirmation flag for local seed apply.', kind: 'boolean' },
			{ name: 'strict', flags: '--strict', description: 'Reserved for stricter future diagnostics; Phase 1 validation is already strict.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed seed treeseed --validate',
			'treeseed seed treeseed --environments local --plan',
			'trsd seed treeseed --environments prod --plan --json',
			'trsd seed export treeseed --team treeseed --include-artifacts --json',
		],
		help: {
			workflowPosition: 'validate',
			longSummary: [
				'Seed validates a declarative market portfolio manifest and produces a deterministic reconciliation plan.',
				'Phase 5 also exports an existing team portfolio into a reusable YAML seed bundle without embedding secrets or artifact bytes.',
			],
			whenToUse: [
				'Use this when a TreeSeed workspace needs a repeatable description of teams, projects, repositories, capacity providers, grants, and work policies.',
				'Use `--json` when an agent or CI check needs the same plan in a stable machine-readable shape.',
			],
			beforeYouRun: [
				'Run from a Treeseed project containing the requested `seeds/<name>.yaml` manifest.',
				'Choose the target environments explicitly when reviewing staging or production resources.',
			],
			outcomes: [
				'Prints validation diagnostics, a deterministic plan, an apply summary, or an exported seed manifest.',
				'Mutates the local market store for local applies, or the selected authenticated market for staging applies and approved production applies.',
			],
			automationNotes: [
				'Agents may run validation and planning safely. Production apply requires an approved seed approval request.',
				'Skipped resources are omitted from human plan output but included in JSON actions for review.',
			],
			warnings: [
				'Do not put raw secrets in seed manifests; validation rejects secret-looking fields and values.',
				'`--apply --environments prod` is blocked until a matching approval request is approved.',
			],
			relatedDetails: [
				related('projects', 'Use `projects` after Phase 2 apply work lands to inspect created projects through the API.'),
				related('capacity', 'Use `capacity` to inspect existing provider and grant state outside the seed planner.'),
			],
		},
		helpVisible: true,
		helpFeatured: true,
		executionMode: 'handler',
		handlerName: 'seed',
	},
		{
			id: 'demo.generate',
			name: 'demo',
			aliases: [],
			group: 'Validation',
			summary: 'Generate the seed-driven TreeSeed demo workflow.',
			description: 'Resolve a seed operation recipe DAG and coordinate the local UI and CLI acceptance demo, including screenshots, Playwright video, traces, private TreeDX, capacity provider registration, allocation, work, artifact review, and publishing.',
			provider: 'default',
			related: ['dev', 'capacity', 'db', 'projects'],
			usage: 'treeseed demo generate [--seed treeseed] [--recipe full-private-team-demo] [--environment local] [--base-url <url>] [--artifacts-dir <dir>] [--plan|--execute] [--json]',
			arguments: [{ name: 'action', description: 'Demo action. Use generate.', required: false }],
			options: [
				{ name: 'seed', flags: '--seed <seed>', description: 'Seed manifest that contains the operation recipe. Defaults to treeseed.', kind: 'string' },
				{ name: 'recipe', flags: '--recipe <recipe>', description: 'Operation recipe id to plan or execute. Defaults to full-private-team-demo.', kind: 'string' },
				{ name: 'environment', flags: '--environment <environment>', description: 'Demo environment. Defaults to local.', kind: 'enum', values: ['local'] },
				{ name: 'baseUrl', flags: '--base-url <url>', description: 'Base URL for the Playwright-controlled UI.', kind: 'string' },
				{ name: 'artifactsDir', flags: '--artifacts-dir <dir>', description: 'Directory for screenshots, traces, and videos.', kind: 'string' },
				{ name: 'plan', flags: '--plan', description: 'Print the resolved operation recipe DAG without executing it. This is the default when --execute is absent.', kind: 'boolean' },
				{ name: 'execute', flags: '--execute', description: 'Run the Playwright demo suite instead of printing the generation plan.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: [
				'treeseed demo generate --seed treeseed --recipe full-private-team-demo --environment local --plan --json',
				'treeseed demo generate --seed treeseed --recipe full-private-team-demo --environment local --execute --json',
			],
			help: {
				workflowPosition: 'validate',
				longSummary: ['Demo generation proves the TreeSeed value loop from the canonical seed recipe instead of a separate demo-only checklist.'],
				whenToUse: ['Use this for the production-shaped local demo release gate and documentation artifact capture.'],
				beforeYouRun: ['Start the managed local runtime first with `npx trsd dev start --web-runtime local --json`.'],
				outcomes: ['Reports or runs the Playwright workflow that captures screenshots, videos, and traces.'],
				automationNotes: ['Use `--json` to read the resolved seed recipe DAG and artifact paths. Use `--execute` only after the local web/API runtime is healthy.'],
			},
			helpVisible: true,
			helpFeatured: true,
			executionMode: 'handler',
			handlerName: 'demo',
		},
		{
			id: 'audit.hosting',
			name: 'audit',
		aliases: [],
		group: 'Validation',
		summary: 'Audit TreeSeed hosting readiness.',
		description: 'Run a read-only or explicit repair audit for Repository, Web, Processing, and Email hosting setup.',
		provider: 'default',
		related: ['status', 'config', 'save', 'release'],
		usage: 'treeseed audit hosting [--environment current|local|staging|prod] [--repair] [--live] [--json]',
		arguments: [{ name: 'target', description: 'Audit target. Use hosting.', required: false }],
		options: [
			{ name: 'environment', flags: '--environment <environment>', description: 'Audit environment. Defaults to current branch mapping.', kind: 'enum', values: ['current', 'local', 'staging', 'prod'] },
			{ name: 'repair', flags: '--repair', description: 'Explicitly reconcile missing platform/provider resources.', kind: 'boolean' },
			{ name: 'live', flags: '--live', description: 'Collect live Railway and HTTP observations for hosted service checks.', kind: 'boolean' },
			{ name: 'hostKinds', flags: '--host-kinds <kinds>', description: 'Comma-separated host kinds to audit.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit the hosting audit report as JSON.', kind: 'boolean' },
		],
		examples: ['treeseed audit hosting', 'treeseed audit hosting --environment staging --json', 'treeseed audit hosting --repair --environment prod'],
		help: {
			workflowPosition: 'validate',
			longSummary: [
				'The hosting audit proves that TreeSeed can use its configured Repository, Web, Processing, and Email platforms before saving hosts or launching team projects.',
				'It is read-only by default. Use `--repair` only when you explicitly want TreeSeed to reconcile provider resources.',
			],
			whenToUse: [
				'Run this before saving managed hosts, launching a hub, or promoting a release that depends on hosted provider resources.',
				'Use it after changing provider credentials or service topology to verify that the selected environment is complete.',
			],
			beforeYouRun: [
				'Run from the TreeSeed workspace you want to audit.',
				'Use `--json` for automation and `--repair` only for deliberate provider reconciliation.',
			],
			automationNotes: [
				'The report lists missing key names and resource identifiers but never prints decrypted secret values.',
				'Save, stage, and release resource verification can include the same read-only audit; repair remains explicit.',
			],
		},
		helpVisible: true,
		helpFeatured: true,
		executionMode: 'handler',
		handlerName: 'audit',
	},
	{
		id: 'tools.gh',
		name: 'gh',
		aliases: [],
		group: 'Passthrough',
		summary: 'Run the managed GitHub CLI with Treeseed environment credentials.',
		description: 'Decrypt Treeseed machine configuration for the selected environment and pass it to the managed GitHub CLI.',
		provider: 'default',
		related: ['tools', 'install', 'config'],
		usage: 'treeseed gh [--environment staging] -- <gh-args>',
		arguments: [{ name: 'args', description: 'Arguments forwarded to GitHub CLI.', required: false }],
		options: TOOL_WRAPPER_OPTIONS,
		examples: ['treeseed gh --environment staging -- run list --limit 5', 'treeseed gh -- repo view'],
		help: {
			longSummary: ['The GitHub wrapper resolves the Treeseed-managed `gh` executable, decrypts scoped machine configuration, and passes the resulting GitHub token only to the child process environment.'],
			whenToUse: ['Use this when provider auth lives in Treeseed machine config rather than your shell environment.'],
			beforeYouRun: ['Run from a Treeseed project. Use `--environment staging` unless you intentionally need local or production credentials.'],
			automationNotes: ['Use `--` before target CLI flags when a flag could be parsed by Treeseed itself. The wrapper does not print decrypted secrets.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'gh',
	},
	{
		id: 'tools.railway',
		name: 'railway',
		aliases: [],
		group: 'Passthrough',
		summary: 'Run the managed Railway CLI with Treeseed environment credentials.',
		description: 'Decrypt Treeseed machine configuration for the selected environment, select the matching Railway environment, and pass it to the managed Railway CLI.',
		provider: 'default',
		related: ['tools', 'install', 'config'],
		usage: 'treeseed railway [--environment staging] -- <railway-args>',
		arguments: [{ name: 'args', description: 'Arguments forwarded to Railway CLI.', required: false }],
		options: TOOL_WRAPPER_OPTIONS,
		examples: ['treeseed railway --environment staging -- whoami', 'treeseed railway --environment staging -- status', 'treeseed railway --environment prod -- status'],
		help: {
			longSummary: ['The Railway wrapper resolves the Treeseed-managed Railway executable, decrypts scoped machine configuration, selects the requested Railway environment, and passes the resulting Railway token only to the child process environment.'],
			whenToUse: ['Use this to debug Railway projects and service builds with Treeseed-managed `TREESEED_RAILWAY_API_TOKEN`, translated to `RAILWAY_API_TOKEN` only for the Railway child process.'],
			beforeYouRun: ['Run from a Treeseed project. Use `--environment staging` when inspecting staging deployments and `--environment prod` when inspecting Railway production.'],
			automationNotes: ['Use `--` before target CLI flags when a flag could be parsed by Treeseed itself. The wrapper does not print decrypted secrets.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'railway',
	},
	{
		id: 'tools.wrangler',
		name: 'wrangler',
		aliases: [],
		group: 'Passthrough',
		summary: 'Run the managed Wrangler CLI with Treeseed environment credentials.',
		description: 'Decrypt Treeseed machine configuration for the selected environment and pass it to the managed Wrangler CLI.',
		provider: 'default',
		related: ['tools', 'install', 'config'],
		usage: 'treeseed wrangler [--environment staging] -- <wrangler-args>',
		arguments: [{ name: 'args', description: 'Arguments forwarded to Wrangler CLI.', required: false }],
		options: TOOL_WRAPPER_OPTIONS,
		examples: ['treeseed wrangler --environment staging -- whoami', 'treeseed wrangler --environment staging -- d1 list'],
		help: {
			longSummary: ['The Wrangler wrapper resolves the Treeseed-managed Wrangler executable, decrypts scoped machine configuration, and passes the resulting Cloudflare token and account settings only to the child process environment.'],
			whenToUse: ['Use this to debug Cloudflare resources with Treeseed-managed `TREESEED_CLOUDFLARE_API_TOKEN` and `TREESEED_CLOUDFLARE_ACCOUNT_ID`, translated to Cloudflare-native names only for the Wrangler child process.'],
			beforeYouRun: ['Run from a Treeseed project. Use `--environment staging` when inspecting staging resources.'],
			automationNotes: ['Use `--` before target CLI flags when a flag could be parsed by Treeseed itself. The wrapper does not print decrypted secrets.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'wrangler',
	},
	{
		id: 'tools.docker',
		name: 'docker',
		aliases: [],
		group: 'Passthrough',
		summary: 'Run Docker with Treeseed DockerHub credentials.',
		description: 'Decrypt Treeseed machine configuration for the selected environment, authenticate Docker with an isolated config directory, and forward arguments to Docker.',
		provider: 'default',
		related: ['tools', 'install', 'config'],
		usage: 'treeseed docker [--environment staging] -- <docker-args>',
		arguments: [{ name: 'args', description: 'Arguments forwarded to Docker.', required: false }],
		options: TOOL_WRAPPER_OPTIONS,
		examples: ['treeseed docker --environment prod -- buildx imagetools inspect treeseed/agent-api:1.2.3', 'treeseed docker --environment prod -- manifest inspect treeseed/agent-runner:1.2.3'],
		help: {
			longSummary: ['The Docker wrapper resolves Docker, decrypts scoped Treeseed DockerHub credentials, logs in through an isolated `DOCKER_CONFIG`, and forwards Docker arguments without printing secrets.'],
			whenToUse: ['Use this for authenticated DockerHub manifest checks, image pulls, and emergency image publication diagnostics. Official image publication should still use package image reconciliation unless explicitly repairing a blocked provider state.'],
			beforeYouRun: ['Run from a Treeseed project. Use `--environment staging` or `--environment prod` for hosted image checks. API and operations runner staging services deploy from Railway Git source builds; production uses Docker images produced by release workflows.'],
			automationNotes: ['Use `--` before target Docker flags when a flag could be parsed by Treeseed itself. The wrapper removes its temporary Docker config after the command exits.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'docker',
	},
	{
		id: 'market.registry',
		name: 'market',
		aliases: [],
		group: 'Utilities',
		summary: 'Manage configured Treeseed API endpoints.',
		description: 'List, add, select, remove, and inspect API profiles stored in local machine configuration.',
		provider: 'default',
		related: ['auth:login', 'teams', 'projects'],
		usage: 'treeseed market [list|add|use|remove|status]',
		arguments: [{ name: 'action', description: 'Market action.', required: false }],
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'label', flags: '--label <label>', description: 'Display label for market add.', kind: 'string' },
			{ name: 'kind', flags: '--kind <kind>', description: 'Market kind for market add.', kind: 'enum', values: ['central', 'specialized'] },
			{ name: 'team', flags: '--team <team-id>', description: 'Team id for a specialized market profile.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed market list', 'treeseed market add enterprise https://market.example.com', 'treeseed market use central'],
		help: {
			longSummary: ['Market manages local Treeseed API profiles. It never serves market behavior itself; it only selects endpoints the SDK market client should call.'],
			whenToUse: ['Use this when you need to add an enterprise market, switch back to central, or inspect which market endpoint CLI commands will target.'],
			beforeYouRun: ['Decide whether you are managing the always-available central profile or a team-specific specialized market profile.'],
			automationNotes: ['Use `--json` when scripts need the active market id, URL, and configured profiles.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'market',
	},
	{
		id: 'market.teams',
		name: 'teams',
		aliases: [],
		group: 'Utilities',
		summary: 'Inspect teams from the selected market.',
		description: 'List teams, select a team context, and inspect team membership through the API client.',
		provider: 'default',
		related: ['market', 'auth:login', 'projects'],
		usage: 'treeseed teams [list|use|members]',
		arguments: [{ name: 'action', description: 'Teams action.', required: false }],
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'team', flags: '--team <team-id>', description: 'Team id for member lookup.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed teams list', 'treeseed teams members team_123'],
		help: {
			longSummary: ['Teams reads team membership data from the selected API using the SDK market client.'],
			whenToUse: ['Use this after login to confirm team membership or inspect who belongs to a market-owned team.'],
			beforeYouRun: ['Authenticate to the selected market with `treeseed auth:login --market <id>` before reading private team data.'],
			automationNotes: ['Use `--json` for scripts that need stable team or member arrays.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'teams',
	},
	{
		id: 'market.projects',
		name: 'projects',
		aliases: [],
		group: 'Utilities',
		summary: 'Inspect projects, import repositories, project hosts, and web deployment operations from the selected market.',
		description: 'List market projects, plan/import existing GitHub repositories, inspect access and host bindings, and queue project host or web deployment operations through the API.',
		provider: 'default',
		related: ['market', 'teams', 'config'],
		usage: 'treeseed projects [list|access|hosts|import|deploy|publish|monitor|deployments|deployment]',
		arguments: [
			{ name: 'action', description: 'Projects action.', required: false },
			{ name: 'project-id', description: 'Project id for deployment and access actions.', required: false },
			{ name: 'deployment-id', description: 'Deployment id for deployment detail, retry, resume, or cancel.', required: false },
		],
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'team', flags: '--team <team-id>', description: 'Limit project list to a team.', kind: 'string' },
			{ name: 'plan', flags: '--plan', description: 'For `projects import`, print the safe import plan without mutating TreeSeed records.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'For `projects import`, apply the safe import plan through the selected market API.', kind: 'boolean' },
			{ name: 'rootPath', flags: '--root-path <path>', description: 'Repository-relative project root override for `projects import`.', kind: 'string' },
			{ name: 'sitePath', flags: '--site-path <path>', description: 'Repository-relative site implementation path override for `projects import`.', kind: 'string' },
			{ name: 'contentPath', flags: '--content-path <path>', description: 'Repository-relative content path override for `projects import`.', kind: 'string' },
			{ name: 'visibility', flags: '--visibility <public|private>', description: 'Project visibility override for `projects import`.', kind: 'enum', values: ['public', 'private'] },
			{ name: 'credentialRef', flags: '--credential-ref <env:TREESEED_GITHUB_TOKEN...>', description: 'Credential reference for `projects import`; token values are never stored in the import plan.', kind: 'string' },
			{ name: 'environment', flags: '--environment <environment>', description: 'Deployment environment for project web actions.', kind: 'enum', values: ['staging', 'prod'] },
			{ name: 'wait', flags: '--wait', description: 'Poll the queued deployment until it reaches a terminal state.', kind: 'boolean' },
			{ name: 'timeoutSeconds', flags: '--timeout-seconds <seconds>', description: 'Maximum seconds to wait before returning timeout.', kind: 'string' },
			{ name: 'pollIntervalMs', flags: '--poll-interval-ms <milliseconds>', description: 'Polling interval for --wait.', kind: 'string' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Queue a dry-run deployment request when supported.', kind: 'boolean' },
			{ name: 'reason', flags: '--reason <text>', description: 'Presentation-safe reason stored on the deployment request.', kind: 'string' },
			{ name: 'idempotencyKey', flags: '--idempotency-key <key>', description: 'Deterministic idempotency key for the deployment request.', kind: 'string' },
			{ name: 'requirement', flags: '--requirement <key>', description: 'Launch host requirement key for project host resync or rotate operations.', kind: 'string' },
			{ name: 'host', flags: '--host <requirement=provider:host-id>', description: 'Replacement host binding for `projects hosts replace`. Use requirement=provider:managed for a managed host or requirement=none for optional hosts.', kind: 'string', repeatable: true },
			{ name: 'sensitivePassphrase', flags: '--sensitive-passphrase <passphrase>', description: 'Deprecated fail-closed compatibility flag. Project host operations require client-side re-entry or migration instead of API passphrase submission.', kind: 'string' },
			{ name: 'yes', flags: '--yes', description: 'Required confirmation for production deploy and publish actions.', kind: 'boolean' },
			{ name: 'limit', flags: '--limit <count>', description: 'Maximum number of deployments to list.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed projects list',
			'treeseed projects import treeseed-ai/sdk --team treeseed --plan --json',
			'treeseed projects import knowledge-coop/market --team treeseed --site-path . --visibility private --execute --json',
			'treeseed projects access project_123',
			'treeseed projects hosts project_123',
			'treeseed projects hosts audit project_123',
			'treeseed projects hosts replace project_123 --host publicWeb=cloudflare:web-host-123',
			'treeseed projects deploy project_123 --environment staging --wait',
			'treeseed projects publish project_123 --environment prod --yes',
			'treeseed projects deployments project_123 --json',
			'treeseed projects deployment project_123 dep_123',
		],
		help: {
			longSummary: ['Projects reads project, host binding, access, and deployment state from the selected API using the SDK market client.'],
			whenToUse: ['Use this to inspect projects, audit or replace launch host bindings, queue staging or production web deployment operations, and inspect the same state shown in the Market UI.'],
			beforeYouRun: ['Authenticate to the market with `treeseed auth:login --market <selector>` and know the project id before queueing deployment work.'],
			automationNotes: ['Use `--json` to capture project lists, deployment records, events, and wait results for automation.'],
			warnings: ['Production deploy and publish require `--yes`; without it the CLI exits before calling the API.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'projects',
	},
	{
		id: 'market.capacity',
		name: 'capacity',
		aliases: [],
		group: 'Utilities',
		summary: 'Inspect capacity plans and operate the package-owned capacity provider runtime.',
		description: 'Read Market capacity plans and agent-capacity coordination records, migrate static providers to derived native capacity, and operate provider lifecycle resources through canonical reconciliation.',
		provider: 'default',
		related: ['teams', 'projects', 'agents'],
		usage: 'treeseed capacity [doctor|register|plan|migrate|allocation-sets|agent-classes|provider-sessions|assignments|mode-runs|execution-runs|workday-log|decision-planning|execution-inputs|capacity-plans|capacity-plan|workday|workday-summary|workday-run|assignment-explanation|fallback-outputs|treedx-proxy-audit|up|down|restart|logs|status|build|test-local]',
		arguments: [{ name: 'action', description: 'Capacity action.', required: false }],
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'provider', flags: '--provider <provider-id>', description: 'Provider id or local provider selector for diagnostics.', kind: 'string' },
			{ name: 'team', flags: '--team <team-id>', description: 'Team id for Market capacity migration or coordination-record inspection.', kind: 'string' },
			{ name: 'project', flags: '--project <project-id>', description: 'Project id for Market capacity plan, allocation migration, agent-class inspection, assignment filtering, or mode-run inspection.', kind: 'string' },
			{ name: 'status', flags: '--status <status>', description: 'Filter provider sessions or assignments by durable lifecycle status.', kind: 'string' },
			{ name: 'mode', flags: '--mode <planning|acting>', description: 'Filter project mode-run inspection by kernel mode.', kind: 'string' },
			{ name: 'assignment', flags: '--assignment <assignment-id>', description: 'Filter project mode-run inspection by provider assignment id.', kind: 'string' },
			{ name: 'decision', flags: '--decision <decision-id>', description: 'Decision id for planning readiness and execution input inspection.', kind: 'string' },
			{ name: 'workday', flags: '--workday <workday-id>', description: 'Workday id for capacity envelope and settlement summary inspection.', kind: 'string' },
			{ name: 'projects', flags: '--projects <all|csv>', description: 'Project slug selector for portfolio workdays.', kind: 'string' },
			{ name: 'seed', flags: '--seed <profile>', description: 'Seed profile to verify before scheduling an API-owned workday.', kind: 'string' },
			{ name: 'purpose', flags: '--purpose <text>', description: 'Human purpose label for the workday run.', kind: 'string' },
			{ name: 'workdays', flags: '--workdays <count>', description: 'Number of coordinated workdays to schedule.', kind: 'string' },
			{ name: 'durationSeconds', flags: '--duration-seconds <seconds>', description: 'Minimum duration for the live workday before settlement and scoring.', kind: 'string' },
			{ name: 'maxAssignments', flags: '--max-assignments <count>', description: 'Safety ceiling for assignments synthesized during the workday.', kind: 'string' },
			{ name: 'maxActiveAssignments', flags: '--max-active-assignments <count>', description: 'Maximum active API-synthesized assignments to keep queued while the timed workday is open.', kind: 'string' },
			{ name: 'planningOnly', flags: '--planning-only', description: 'Limit workday expectations to planning mode.', kind: 'boolean' },
			{ name: 'acting', flags: '--acting', description: 'Allow acting-capable output expectations when approved decisions exist.', kind: 'boolean' },
			{ name: 'abort', flags: '--abort', description: 'Abort a live workday when degradation or failed assignment evidence appears.', kind: 'boolean' },
			{ name: 'reportDir', flags: '--report-dir <path>', description: 'Directory for generated workday JSON and Markdown reports.', kind: 'string' },
			{ name: 'environment', flags: '--environment <scope>', description: 'Treeseed config scope used when resolving encrypted provider launch values.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'toDerived', flags: '--to-derived', description: 'Migrate a static provider to derived native capacity facts.', kind: 'boolean' },
			{ name: 'kind', flags: '--kind <provider-kind>', description: 'Execution provider kind such as codex_subscription or openrouter.', kind: 'string' },
			{ name: 'executionProvider', flags: '--execution-provider <id>', description: 'Filter execution-run audit output to one native execution provider id.', kind: 'string' },
			{ name: 'format', flags: '--format <text|yaml|timeline|tree|json>', description: 'Render selected inspection commands as text, YAML, timeline, tree, or JSON.', kind: 'string' },
			{ name: 'limit', flags: '--limit <count>', description: 'Maximum execution-run audit records to return.', kind: 'string' },
			{ name: 'nativeUnit', flags: '--native-unit <unit>', description: 'Native unit humans can forecast, such as wall_minute, usd, or billable_token.', kind: 'string' },
			{ name: 'limit', flags: '--limit <amount>', description: 'Native limit amount for the selected scope.', kind: 'string' },
			{ name: 'scope', flags: '--scope <scope>', description: 'Native limit scope, usually daily or monthly.', kind: 'string' },
			{ name: 'resetCadence', flags: '--reset-cadence <cadence>', description: 'Native limit reset cadence.', kind: 'string' },
			{ name: 'quotaVisibility', flags: '--quota-visibility <mode>', description: 'Whether quota remaining is visible, sampled, or opaque.', kind: 'string' },
			{ name: 'reserveBufferPercent', flags: '--reserve-buffer-percent <percent>', description: 'Native reserve buffer percentage.', kind: 'string' },
			{ name: 'maxConcurrentWorkers', flags: '--max-concurrent-workers <count>', description: 'Maximum workers this execution provider can run concurrently.', kind: 'string' },
			{ name: 'portfolioAllocationPercent', flags: '--portfolio-allocation-percent <percent>', description: 'Optional project/team allocation percent to create during migration.', kind: 'string' },
			{ name: 'dataDir', flags: '--data-dir <path>', description: 'Host data directory mounted into the provider container at /data.', kind: 'string' },
			{ name: 'waitSeconds', flags: '--wait-seconds <seconds>', description: 'Seconds to wait for provider settlement after the timed workday duration.', kind: 'string' },
			{ name: 'mouse', flags: '--mouse', description: 'Opt into mouse capture for interactive forensic workday-log views when available.', kind: 'boolean' },
			{ name: 'config', flags: '--config <path>', description: 'Capacity provider launch manifest path.', kind: 'string' },
			{ name: 'agentPackageRoot', flags: '--agent-package-root <path>', description: 'Path to a built @treeseed/agent package root.', kind: 'string' },
			{ name: 'diagnostic', flags: '--diagnostic', description: 'Start lifecycle commands without live Market registration or provider credentials.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Ask the provider runtime to render deterministic output without provider secrets or Market mutation.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Render the selected capacity-provider reconcile plan without mutating local Docker or provider state.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'Apply the selected capacity-provider reconcile resources.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed capacity doctor --market local --provider local',
			'treeseed capacity plan --market local --project project_123 --environment local',
			'treeseed capacity register --market local --provider local --dry-run --json',
			'treeseed capacity plan --market local --provider local --dry-run --json',
			'treeseed capacity migrate --to-derived --market local --team team_123 --provider provider_123 --kind codex_subscription --native-unit wall_minute --limit 480 --scope daily --dry-run',
			'treeseed capacity allocation-sets --market local --team team_123 --json',
			'treeseed capacity agent-classes --market local --project project_123 --json',
			'treeseed capacity provider-sessions --market local --team team_123 --provider provider_123 --json',
			'treeseed capacity assignments --market local --team team_123 --status leased --json',
			'treeseed capacity mode-runs --market local --project project_123 --mode planning --json',
			'treeseed capacity execution-runs --market local --team treeseed --kind codex_subscription --format yaml',
			'treeseed capacity workday-log --market local --team treeseed --workday workday_123 --format tree',
			'treeseed capacity decision-planning --market local --decision decision_123 --json',
			'treeseed capacity execution-inputs --market local --decision decision_123 --json',
			'treeseed capacity capacity-plans --market local --decision decision_123 --json',
			'treeseed capacity capacity-plan --market local --capacity-plan capacity_plan_123 --json',
			'treeseed capacity workday-summary --market local --workday workday_123 --json',
			'treeseed capacity workday-run --market local --team team_123 --provider local --workdays 1 --duration-seconds 900 --execute --json',
			'treeseed capacity assignment-explanation --market local --team team_123 --assignment assignment_123 --json',
			'treeseed capacity fallback-outputs --market local --project project_123 --json',
			'treeseed capacity treedx-proxy-audit --market local --project project_123 --assignment assignment_123 --json',
			'treeseed capacity build',
			'treeseed capacity up --market local --provider local',
			'treeseed capacity up --config treeseed.capacity-provider.yaml',
			'treeseed capacity up --market local --provider local --diagnostic',
			'treeseed capacity status --market local --provider local',
			'treeseed capacity logs --market local --provider local',
			'treeseed capacity down --market local --provider local',
			'treeseed capacity test-local',
		],
		help: {
			longSummary: ['Capacity reads Market project capacity plans and durable agent-capacity coordination records, migrates provider setup toward derived native facts, and routes package-owned provider lifecycle resources through canonical reconciliation.'],
			whenToUse: ['Use this when inspecting native-to-credit projection, allocation-set versions, project agent classes, decision readiness, execution inputs, provider sessions, assignment lifecycle, mode-run telemetry, workday summaries, or the local provider stack.'],
			beforeYouRun: ['Build @treeseed/agent first, or pass --agent-package-root to a built package. Use `trsd config` for encrypted provider values; capacity commands do not write plaintext env files.'],
			automationNotes: ['Use `--json` for stable output. Assignment, mode-run, and assignment-explanation inspection includes read-only execution visibility and capability match summaries. Lifecycle actions are dry-run unless `--execute` is supplied.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'capacity',
	},
	{
		id: 'hosting',
		name: 'hosting',
		aliases: [],
		group: 'Utilities',
		summary: 'Plan, apply, verify, and inspect the Treeseed hosting graph.',
		description: 'Resolve host-agnostic service types into environment-specific host bindings for local dev, staging, and production.',
		provider: 'default',
		related: ['status', 'dev', 'config', 'stage', 'release'],
		usage: 'treeseed hosting [status|plan|apply|verify|destroy] [--environment local|staging|prod] [--app web|api] [--service api] [--json]',
		arguments: [{ name: 'action', description: 'Hosting action.', required: false }],
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Hosting environment to resolve.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'app', flags: '--app <app-id>', description: 'Limit hosting graph work to one discovered Treeseed application, such as web or api.', kind: 'string' },
			{ name: 'service', flags: '--service <service-id>', description: 'Limit hosting graph work to one service id. Repeat or comma-separate for multiple services.', kind: 'string' },
			{ name: 'placement', flags: '--placement <placement>', description: 'Limit hosting graph work to one service placement.', kind: 'string' },
			{ name: 'host', flags: '--host <host-id>', description: 'Limit hosting graph work to one host id.', kind: 'string' },
			{ name: 'live', flags: '--live', description: 'Request live provider verification where supported.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Force apply to render a non-mutating dry-run result.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'Allow hosting apply to call adapter apply methods for the selected environment.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed hosting status --environment local',
			'treeseed hosting plan --environment staging --json',
			'treeseed hosting plan --environment staging --app web --json',
			'treeseed hosting plan --environment staging --app api --json',
			'treeseed hosting plan --environment staging --service api --json',
			'treeseed hosting verify --environment prod --json',
			'treeseed hosting apply --environment staging --app api --execute --json',
			'treeseed hosting destroy --environment staging --app api --execute --json',
		],
		help: {
			longSummary: ['Hosting resolves Treeseed application profiles into service placements, service types, host capabilities, and provider/local resources.'],
			whenToUse: ['Use this before dev, stage, or release when you need to inspect host bindings, missing capabilities, or TreeDX/public federation placement.'],
			beforeYouRun: ['Run from the Treeseed workspace. Use `--json` for automation. `apply` is dry-run unless `--execute` is passed.'],
			automationNotes: ['The JSON report includes placements, units, selected hosts, required capabilities, project groups, and verification checks without secret values.'],
		},
		helpVisible: true,
		helpFeatured: true,
		executionMode: 'handler',
		handlerName: 'hosting',
	},
	{
		id: 'reconcile',
		name: 'reconcile',
		aliases: [],
		group: 'Utilities',
		summary: 'Run canonical reconciliation platform diagnostics.',
		description: 'Plan, apply, verify, destroy, and live-test SDK-owned exact-state reconciliation.',
		provider: 'default',
		related: ['hosting', 'config', 'stage', 'release'],
		usage: 'treeseed reconcile [plan|status|verify|apply|destroy|test-live] [--environment local|staging|prod] [--unit-id <id>] [--execute] [--json]',
		arguments: [{ name: 'action', description: 'Reconcile action.', required: false }],
		options: [
			{ name: 'provider', flags: '--provider <provider>', description: 'Provider live-test scope. Use railway, cloudflare, github, local, or all.', kind: 'string' },
			{ name: 'mode', flags: '--mode <mode>', description: 'Live-test mode. Smoke is read-only; acceptance and cleanup mutate isolated provider resources and require --yes.', kind: 'enum', values: ['smoke', 'acceptance', 'cleanup'] },
			{ name: 'environment', flags: '--environment <scope>', description: 'Environment to test.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'unitId', flags: '--unit-id <id>', description: 'Limit plan/apply/verify/destroy to one or more comma-separated desired unit ids.', kind: 'string' },
			{ name: 'unitType', flags: '--unit-type <type>', description: 'Limit plan/apply/verify/destroy to one or more desired unit types.', kind: 'string' },
			{ name: 'resourceKind', flags: '--resource-kind <kind>', description: 'Limit plan/apply/verify/destroy to one or more desired resource kinds.', kind: 'string' },
			{ name: 'packageId', flags: '--package-id <id>', description: 'Limit plan/apply/verify/destroy to one or more Treeseed package ids.', kind: 'string' },
			{ name: 'serviceId', flags: '--service-id <id>', description: 'Limit plan/apply/verify/destroy to one or more service ids.', kind: 'string' },
			{ name: 'serviceType', flags: '--service-type <type>', description: 'Limit plan/apply/verify/destroy to one or more service unit types.', kind: 'string' },
			{ name: 'execute', flags: '--execute', description: 'Allow reconcile apply or destroy to mutate provider resources. Apply is a dry-run without it.', kind: 'boolean' },
			{ name: 'yes', flags: '--yes', description: 'Confirm acceptance or cleanup mode may create and delete real isolated provider resources.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed reconcile plan --environment staging --json',
			'treeseed reconcile verify --environment staging --json',
			'treeseed reconcile apply --environment staging --json',
			'treeseed reconcile apply --environment staging --unit-id github-secret-binding:root:staging:TREESEED_CREDENTIAL_SESSION_SECRET --execute --json',
			'treeseed reconcile apply --environment staging --execute --json',
			'treeseed reconcile test-live --provider local --json',
			'treeseed reconcile test-live --provider railway --environment staging --json',
			'treeseed reconcile test-live --provider all --environment staging --json',
			'treeseed reconcile test-live --mode acceptance --provider railway --environment staging --yes --json',
			'treeseed reconcile test-live --mode cleanup --provider all --environment staging --yes --json',
		],
		help: {
			longSummary: ['Reconcile is the canonical SDK lifecycle for provider state: refresh, diff, plan, validate, apply, refresh, verify, and persist. Smoke mode is fast and read-only. Acceptance mode creates, updates, verifies, and destroys isolated resources. Cleanup mode removes leftover isolated live-test resources. Missing provider coverage is reported as blocking drift, not skipped success.'],
			whenToUse: ['Use this before staging or release promotions when provider tokens are configured, or when adding a new provider/resource adapter.'],
			beforeYouRun: ['Run from the Treeseed workspace. Provider tests use encrypted Treeseed config values and deterministic isolated prefixes.'],
			automationNotes: ['The JSON report contains the desired resource graph, package units, reconcile actions, postconditions, blocked drift, provider limitations, live verification, and ok state.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'reconcile',
	},
	{
		id: 'ready',
		name: 'ready',
		aliases: [],
		group: 'Workflow',
		summary: 'Check whether an environment is ready for staging or release.',
		description: 'Runs deployment graph readiness, hosted service checks, and Treeseed operations runner smoke diagnostics before expensive workflow promotion.',
		provider: 'default',
		related: ['hosting', 'stage', 'release', 'doctor'],
		usage: 'treeseed ready <local|staging|prod> [--live] [--strict] [--json]',
		arguments: [{ name: 'environment', description: 'Environment to check.', required: false }],
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Environment to check.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'live', flags: '--live', description: 'Include live provider and HTTP checks.', kind: 'boolean' },
			{ name: 'strict', flags: '--strict', description: 'Fail when required live observations are unavailable.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed ready staging --json',
			'treeseed ready prod --json',
		],
		help: {
			longSummary: ['Ready is the fail-fast preflight for stage and release. It checks the effective hosting graph, provider state, HTTP health, and runner operation processing before a workflow spends time on deploys.'],
			whenToUse: ['Run before stage or release, especially after hosting config or package boundary changes.'],
			beforeYouRun: ['Run from the Treeseed workspace. Use `ready local` for static local checks, and use staging or prod only when provider credentials are available for live checks.'],
			automationNotes: ['Use --json for stable readiness output. Staging and prod default to live strict checks.'],
		},
		helpVisible: true,
		helpFeatured: true,
		executionMode: 'handler',
		handlerName: 'ready',
	},
	{
		id: 'operations',
		name: 'operations',
		aliases: [],
		group: 'Utilities',
		summary: 'Run Treeseed operation-runner diagnostics.',
		description: 'Queues a diagnostic Market platform operation and verifies that the deployed operations runner claims and completes it.',
		provider: 'default',
		related: ['hosting', 'ready', 'stage'],
			usage: 'treeseed operations smoke [--environment local|staging|prod] [--service operationsRunner] [--json]',
		arguments: [{ name: 'action', description: 'Operations action.', required: false }],
		options: [
				{ name: 'environment', flags: '--environment <scope>', description: 'Environment to smoke test.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'service', flags: '--service <service-id>', description: 'Service to smoke test. Currently operationsRunner.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: [
				'treeseed operations smoke --environment local --service operationsRunner --json',
				'treeseed operations smoke --environment staging --service operationsRunner --json',
			],
			help: {
				longSummary: ['Operations smoke proves that the API, database, and operations runner work together before TreeDX/bootstrap workflows queue real work.'],
				whenToUse: ['Run when local or hosted operations stay queued, or before release resource verification.'],
				beforeYouRun: ['For local, start managed dev with `treeseed dev start --web-runtime local`. For hosted environments, run after the API and operations runner are deployed and configured through Treeseed config.'],
				automationNotes: ['The JSON report redacts credentials and includes operation id, final status, runner id, timings, and failure remediation.'],
			},
		helpVisible: true,
		helpFeatured: true,
		executionMode: 'handler',
		handlerName: 'operations',
	},
	{
		id: 'workflow.dispatch',
		name: 'workflow',
		aliases: [],
		group: 'Utilities',
		summary: 'Plan or dispatch a GitHub Actions workflow through reconciliation.',
		description: 'Triggers a workflow_dispatch run through the github-workflow-dispatch reconcile adapter so package and root workflows can be tested without pushing commits.',
		provider: 'default',
		related: ['package', 'gh', 'ci'],
		usage: 'treeseed workflow dispatch --repo <owner/name> --workflow <file> [--branch <ref>] [--input key=value]... [--execute] [--wait] [--json]',
		arguments: [{ name: 'action', description: 'Workflow action. Use dispatch.', required: false }],
		options: [
			{ name: 'repo', flags: '--repo <owner/name>', description: 'GitHub repository that owns the workflow.', kind: 'string' },
			{ name: 'repository', flags: '--repository <owner/name>', description: 'Alias for --repo.', kind: 'string' },
			{ name: 'workflow', flags: '--workflow <file>', description: 'Workflow file name or path, such as release-gate.yml.', kind: 'string' },
			{ name: 'branch', flags: '--branch <ref>', description: 'Branch or ref to dispatch. Defaults to staging.', kind: 'string' },
			{ name: 'ref', flags: '--ref <ref>', description: 'Alias for --branch.', kind: 'string' },
			{ name: 'input', flags: '--input <key=value>', description: 'workflow_dispatch input. Repeat for multiple inputs.', kind: 'string', repeatable: true },
			{ name: 'plan', flags: '--plan', description: 'Observe and plan without dispatching. This is the default when --execute is omitted.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'Dispatch the workflow. Without this flag, only plan and observe.', kind: 'boolean' },
			{ name: 'wait', flags: '--wait', description: 'Wait for the dispatched run to finish. Defaults to on when --execute is used.', kind: 'boolean' },
			{ name: 'timeout', flags: '--timeout <seconds>', description: 'Wait timeout in seconds when --wait is active.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable output.', kind: 'boolean' },
		],
		examples: [
			'treeseed workflow dispatch --repo treeseed-ai/agent --workflow release-gate.yml --branch staging --plan --json',
			'treeseed workflow dispatch --repo treeseed-ai/agent --workflow release-gate.yml --branch staging --execute --json',
		],
		help: {
			longSummary: ['Workflow dispatch is a generic reconciler-backed way to run workflow_dispatch workflows without creating a new commit or push. It uses the same GitHub credential routing and adapter lifecycle as package image publication.'],
			whenToUse: ['Use this to test release-gate workflows or no-op diagnostic workflows from the CLI when a push-triggered run is unnecessary.'],
			beforeYouRun: ['Make sure the selected repository has a Treeseed repository-scoped GitHub token with Actions write permission when dispatching outside the root repository. Plan mode is safe and reports credential blockers.'],
			automationNotes: ['Without --execute this command only refreshes and plans. With --execute it dispatches through github-workflow-dispatch and waits by default so failures are visible in the command result.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'workflow',
	},
	{
		id: 'workspace.package',
		name: 'package',
		aliases: [],
		group: 'Utilities',
		summary: 'Run manifest-driven package workflow planning.',
		description: 'Validate package manifests and plan deployment source/image behavior declared by treeseed.package.yaml.',
		provider: 'default',
		related: ['config', 'hosting', 'db'],
		usage: 'treeseed package [validate|image|workflow sync] [--package <package-id>]',
		arguments: [{ name: 'action', description: 'Package workflow action.', required: false }],
		options: [
			{ name: 'package', flags: '--package <package-id>', description: 'Discovered package id from treeseed.package.yaml, such as treedx.', kind: 'string' },
			{ name: 'branch', flags: '--branch <branch>', description: 'Package repository branch/ref for source-build planning. Defaults to staging.', kind: 'string' },
			{ name: 'workflow', flags: '--workflow <file>', description: 'GitHub Actions workflow file for package image publication. Defaults to the package manifest.', kind: 'string' },
			{ name: 'syncConfig', flags: '--sync-config', description: 'Sync package image credentials from Treeseed config into the package GitHub environment.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Print the package image plan without dispatching GitHub Actions.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'Dispatch a production image workflow when the package policy allows image publication.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed package validate --json',
			'treeseed package workflow sync --package all --plan --json',
			'treeseed package image --package treedx --branch staging --plan --json',
			'treeseed package image --package treedx --branch main --plan --json',
		],
		help: {
			longSummary: ['Package workflows are driven by package-local metadata instead of bespoke CLI logic. A checked-out package can declare its repository, production image workflow, hosting source mode, and credential requirements in treeseed.package.yaml.'],
			whenToUse: ['Use this to validate source-build staging behavior or production semantic image publication for packages such as TreeDX.'],
			beforeYouRun: ['Run `trsd config` to configure repository-scoped GitHub credentials and provider secrets. Do not pass package repository tokens or Docker Hub secrets on the command line.'],
			automationNotes: ['Use `--json` to capture selected package metadata, repository credential routing, source-build readiness, Docker Hub readiness for production, and the hosting override command.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'package',
	},
	{
		id: 'market.db',
		name: 'db',
		aliases: [],
		group: 'Utilities',
		summary: 'Manage team TreeDX knowledge-library bindings.',
		description: 'Inspect, provision, connect, mirror, share, publish, bind TreeDX libraries, and plan TreeDX deployment source/image policy.',
		provider: 'default',
		related: ['teams', 'projects', 'capacity'],
		usage: 'treeseed db [status|provision|connect|mirrors|shares|library|topology|publish|image]',
		arguments: [{ name: 'action', description: 'TreeDX action.', required: false }],
		options: [
			{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
			{ name: 'team', flags: '--team <team-id>', description: 'Team id for status, provisioning, mirrors, and shares.', kind: 'string' },
			{ name: 'project', flags: '--project <project-id>', description: 'Project id for library binding and topology inspection.', kind: 'string' },
			{ name: 'public', flags: '--public', description: 'Use public federation posture for provisioning or sharing.', kind: 'boolean' },
			{ name: 'selfHosted', flags: '--self-hosted', description: 'Connect a self-hosted TreeDX URL as the primary binding.', kind: 'boolean' },
			{ name: 'url', flags: '--url <url>', description: 'TreeDX base URL for connect/provision.', kind: 'string' },
			{ name: 'registryUrl', flags: '--registry-url <url>', description: 'Optional TreeDX registry URL.', kind: 'string' },
			{ name: 'image', flags: '--image <image-ref>', description: 'TreeDX container image ref, default treeseed/treedx:latest.', kind: 'string' },
			{ name: 'name', flags: '--name <name>', description: 'Mirror display name.', kind: 'string' },
			{ name: 'targetUrl', flags: '--target-url <url>', description: 'Mirror target URL.', kind: 'string' },
			{ name: 'targetKind', flags: '--target-kind <kind>', description: 'Mirror target kind such as git or treedx.', kind: 'string' },
			{ name: 'direction', flags: '--direction <mode>', description: 'Mirror direction: pull, push, or bidirectional.', kind: 'string' },
			{ name: 'scope', flags: '--scope <scope>', description: 'Share scope: team, library, or public_federation.', kind: 'string' },
			{ name: 'targetTeam', flags: '--target-team <team-id>', description: 'Target team id for a team share.', kind: 'string' },
			{ name: 'library', flags: '--library <library-id>', description: 'TreeDX library id for project binding or share.', kind: 'string' },
			{ name: 'instance', flags: '--instance <instance-id>', description: 'TreeDX instance id for project binding.', kind: 'string' },
			{ name: 'repository', flags: '--repository <repo-id>', description: 'TreeDX repository id for project binding.', kind: 'string' },
			{ name: 'contentRepositoryUrl', flags: '--content-repository-url <url>', description: 'Linked GitHub content repository URL.', kind: 'string' },
			{ name: 'environment', flags: '--environment <scope>', description: 'Publish environment for db publish: staging or prod.', kind: 'enum', values: ['staging', 'prod'] },
			{ name: 'branch', flags: '--branch <branch>', description: 'TreeDX branch/ref for source-build planning. Defaults to staging.', kind: 'string' },
			{ name: 'workflow', flags: '--workflow <file>', description: 'TreeDX GitHub Actions workflow file for production image publication.', kind: 'string' },
			{ name: 'syncConfig', flags: '--sync-config', description: 'Sync package image credentials from Treeseed config into the package GitHub environment.', kind: 'boolean' },
			{ name: 'plan', flags: '--plan', description: 'Print the TreeDX image plan without dispatching GitHub Actions.', kind: 'boolean' },
			{ name: 'execute', flags: '--execute', description: 'Dispatch the TreeDX production image workflow when policy allows image publication.', kind: 'boolean' },
			{ name: 'yes', flags: '--yes', description: 'Confirm production db publish.', kind: 'boolean' },
			{ name: 'dryRun', flags: '--dry-run', description: 'Queue a dry-run content publish operation.', kind: 'boolean' },
			{ name: 'reason', flags: '--reason <reason>', description: 'Human-readable reason for a content publish.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: [
			'treeseed db status --team team_123',
			'treeseed db provision --team team_123',
			'treeseed db provision --team team_123 --public',
			'treeseed db connect --team team_123 --url https://treedx.example.com --self-hosted',
			'treeseed db mirrors --team team_123 --name customer-copy --target-url https://treedx.customer.example',
			'treeseed db shares --team team_123 --library team/project --public',
			'treeseed db library --project project_123 --library team/project',
			'treeseed db topology --project project_123 --json',
			'treeseed db publish --project project_123 --environment staging',
			'treeseed db image --branch staging --plan --json',
			'treeseed db image --branch main --plan --json',
		],
		help: {
			longSummary: ['TreeDX commands manage the Treeseed control-plane records that bind each team to one primary knowledge-library instance, bind project content to TreeDX libraries, and plan deterministic TreeDX source-build or production image behavior.'],
			whenToUse: ['Use this when provisioning a private TreeDX, attaching a public team to federation, creating mirror/share records, inspecting project content/site/project topology, or publishing the TreeDX image that the API app should reconcile.'],
			beforeYouRun: ['Log in to the selected Treeseed API first for team/project actions. For `db image --execute`, configure GitHub credentials through Treeseed-managed config. Do not pass secrets on the command line; TreeDX credentials belong in host secret managers or encrypted config.'],
			automationNotes: ['Use `--json` for stable TreeDX binding, mirror, share, library, topology, and image policy records. TreeDX, API, operations runner, and agent staging services use source builds. Production image refs are semantic release artifacts.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'db',
	},
	{
		id: 'market.packs',
		name: 'packs',
		aliases: [],
		group: 'Utilities',
		summary: 'Search and download market knowledge packs.',
			description: 'Search knowledge packs and download artifact versions through the integrated market catalog or a selected API.',
		provider: 'default',
		related: ['market', 'template'],
		usage: 'treeseed packs [search|install] [id]',
		arguments: [{ name: 'action', description: 'Packs action.', required: false }],
		options: [
				{ name: 'market', flags: '--market <id-or-url>', description: 'Limit catalog lookup to one configured market id or direct API URL. Without this, search/install uses the integrated catalog from all configured catalog markets.', kind: 'string' },
			{ name: 'version', flags: '--version <version>', description: 'Artifact version for install.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed packs search', 'treeseed packs install pack_123 --version 1.0.0'],
		help: {
				longSummary: ['Packs searches and downloads knowledge pack artifacts from the integrated catalog formed by central and configured specialized markets.'],
			whenToUse: ['Use this when a project should install a market-published knowledge bundle rather than a local fixture.'],
			beforeYouRun: ['Choose the market and artifact version; private packs require an authenticated market session.'],
			automationNotes: ['Use `--json` to capture artifact metadata and the downloaded file path.'],
		},
		helpVisible: true,
		helpFeatured: false,
		executionMode: 'handler',
		handlerName: 'packs',
	},
	{
		id: 'agents.run',
		name: 'agents',
		aliases: [],
		group: 'Utilities',
		summary: 'Run the Treeseed agent runtime namespace.',
		description: 'Delegate to the `@treeseed/agent` runtime namespace and forward the remaining subcommand arguments.',
		provider: 'default',
		related: ['status', 'config'],
		usage: 'treeseed agents <command>',
		arguments: [{ name: 'command', description: 'Agent subcommand and its remaining arguments.', required: false }],
		examples: ['treeseed agents --help'],
		help: {
			longSummary: [
				'Agents is the CLI entrypoint into the Treeseed agent runtime namespace. It forwards the remaining subcommand arguments to the runtime owned by `@treeseed/agent`.',
			],
			whenToUse: [
				'Use this when the thing you want is inside the agent runtime namespace rather than the main Treeseed command set.',
			],
			beforeYouRun: [
				'Make sure the `@treeseed/agent` runtime is installed and available because this command delegates rather than handling the work locally.',
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
			'Delegates to the `@treeseed/agent` runtime.',
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
