import { DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import type { OperationMetadata } from '@treeseed/sdk/operations';
import type {
	CommandArgumentSpec,
	CommandHelpSpec,
	CommandOptionSpec,
	OperationSpec,
	ParsedInvocation,
	StructuredCommandExample,
} from './operations-types.ts';

export type CommandOverlay = {
	usage?: string;
	arguments?: CommandArgumentSpec[];
	options?: CommandOptionSpec[];
	examples?: string[];
	help?: Partial<CommandHelpSpec>;
	notes?: string[];
	helpVisible?: boolean;
	helpFeatured?: boolean;
	executionMode?: OperationSpec['executionMode'];
	handlerName?: string;
	delegateTo?: OperationSpec['delegateTo'];
	buildAdapterInput?: OperationSpec['buildAdapterInput'];
};

export function command(overlay: CommandOverlay): CommandOverlay {
	return overlay;
}

export const workspaceCommand = (name: 'status' | 'link' | 'unlink') => `workspace${':'}${name}`;

export function example(commandLine: string, title: string, description: string, extras: Pick<StructuredCommandExample, 'result' | 'why'> = {}): StructuredCommandExample {
	return {
		command: commandLine,
		title,
		description,
		...extras,
	};
}

export function detail(name: string, detailText: string) {
	return { name, detail: detailText };
}

export function related(name: string, why: string) {
	return { name, why };
}

export const DEV_RUNTIME_OPTIONS: CommandOptionSpec[] = [
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

export const DEV_STATUS_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => ['all', 'json'].includes(option.name));
export const DEV_LOGS_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => ['follow', 'json'].includes(option.name));
export const DEV_STOP_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => ['all', 'json'].includes(option.name));
export const DEV_START_OPTIONS = DEV_RUNTIME_OPTIONS.filter((option) => !['all', 'follow'].includes(option.name));

export function devManagedHelpCommand(
	subcommand: 'start' | 'status' | 'logs' | 'stop' | 'restart',
	spec: {
		summary: string;
		description: string;
		usage: string;
		options: CommandOptionSpec[];
		examples: StructuredCommandExample[];
		whenToUse: string[];
		beforeYouRun: string[];
		outcomes: string[];
		warnings?: string[];
	},
): OperationSpec {
	return {
		id: `dev.${subcommand}` as OperationSpec['id'],
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

function genericWorkflowPosition(spec: Pick<OperationMetadata, 'group' | 'name'>): string {
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

function genericExamples(spec: OperationMetadata, overlay: CommandOverlay): StructuredCommandExample[] {
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

function genericLongSummary(spec: OperationMetadata): string[] {
	return [
		spec.description || spec.summary,
		`This command belongs to the ${spec.group.toLowerCase()} surface and is exposed through the same registry that drives parsing, runtime dispatch, and help rendering.`,
	];
}

function genericWhenToUse(spec: OperationMetadata): string[] {
	return [
		`Use this command when you need the ${spec.summary.replace(/\.$/u, '').toLowerCase()} workflow directly from the Treeseed CLI.`,
		`Reach for \`treeseed ${spec.name}\` when the command name matches the next action you want to take, and then move to related commands for the next stage of the workflow.`,
	];
}

function genericBeforeYouRun(spec: OperationSpec): string[] {
	const lines = ['Run this command from a Treeseed workspace unless the command documentation explicitly says it can run outside a workspace.'];
	if ((spec.options ?? []).some((option) => option.name === 'json')) {
		lines.push('Decide up front whether you want human-readable output or machine-readable `--json` output so downstream automation and shell usage stay predictable.');
	}
	if (spec.executionMode === 'delegate') {
		lines.push('This command delegates to another runtime surface, so make sure the delegated runtime package is installed and available.');
	}
	return lines;
}

function genericOutcomes(spec: OperationSpec): string[] {
	const relatedCommands = spec.related ?? [];
	return [
		`Running this command executes the ${spec.executionMode} path for \`${spec.name}\` and prints the result through the standard Treeseed CLI surface.`,
		...(relatedCommands.length > 0 ? [`After it completes, the most common next commands are ${relatedCommands.map((name) => `\`${name}\``).join(', ')}.`] : []),
	];
}

function genericAutomationNotes(spec: OperationSpec): string[] {
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

function genericWarnings(spec: OperationSpec): string[] {
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

function genericRelatedDetails(spec: OperationSpec) {
	return (spec.related ?? []).map((name) => related(name, `Use \`${name}\` next when you want to continue the workflow immediately after \`${spec.name}\`.`));
}

export function mergeHelpSpec(metadata: OperationMetadata, overlay: CommandOverlay, spec: Omit<OperationSpec, 'help'>): CommandHelpSpec {
	const base: CommandHelpSpec = {
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

export const PASS_THROUGH_ARGS = (invocation: ParsedInvocation) => ({ args: invocation.rawArgs });

export const TOOL_WRAPPER_OPTIONS: CommandOptionSpec[] = [
	{ name: 'environment', flags: '--environment <scope>', description: 'Treeseed environment scope used to decrypt and inject provider credentials.', kind: 'enum', values: ['local', 'staging', 'prod'] },
];
