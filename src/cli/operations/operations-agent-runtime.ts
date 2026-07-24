import type { OperationSpec } from './operations-types.ts';
import {
	devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS,
} from './operations-registry-support.ts';

export const agentRuntimeOperationSpecs: OperationSpec[] = [
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
