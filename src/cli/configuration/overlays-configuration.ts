import { DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from '../operations/operations-registry-support.ts';

export const configurationCommandOverlays: Array<[string, CommandOverlay]> = [
	['config', command({
			options: [
				{ name: 'full', flags: '--full', description: 'Open the advanced full editor directly in human interactive mode.', kind: 'boolean' },
				{ name: 'mouse', flags: '--mouse', description: 'Opt into mouse capture for the config UI. Keyboard-first terminal behavior remains the default.', kind: 'boolean' },
				{ name: 'environment', flags: '--environment <scope>', description: 'Select all environments or limit configuration to local, staging, or prod. Defaults to all.', kind: 'enum', repeatable: true, values: ['all', 'local', 'staging', 'prod'] },
				{ name: 'sync', flags: '--sync <mode>', description: 'Sync hosted secrets/variables to GitHub, Cloudflare, Railway, or all providers. Defaults to all; GitHub binding changes are applied through reconciler-owned units.', kind: 'enum', values: ['none', 'github', 'cloudflare', 'railway', 'all'] },
				{ name: 'nonInteractive', flags: '--non-interactive', description: 'Apply resolved values without opening the interactive UI. Required for non-TTY automation unless using an operational mode such as --print-env-only.', kind: 'boolean' },
				{ name: 'installMissingTooling', flags: '--install-missing-tooling', description: 'Install missing config verification tooling such as `gh-act` during the run instead of only reporting it.', kind: 'boolean' },
				{ name: 'printEnv', flags: '--print-env', description: 'Print resolved environment values before remote initialization.', kind: 'boolean' },
				{ name: 'printEnvOnly', flags: '--print-env-only', description: 'Print resolved environment values, check provider connections, and exit without prompting or initializing remote resources.', kind: 'boolean' },
				{ name: 'rotateMachineKey', flags: '--rotate-machine-key', description: 'Regenerate the local home machine key and re-encrypt stored Treeseed secrets and remote auth sessions.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
				examples: ['treeseed config', 'treeseed config --full --mouse', 'treeseed config --environment all', 'treeseed config --environment local --sync none', 'treeseed config --environment local --sync none --non-interactive', 'treeseed config --environment staging --print-env-only', 'treeseed config --rotate-machine-key'],
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
					example('treeseed config --environment local --sync none', 'Edit local values without provider sync', 'Limit the session to local values and avoid hosted synchronization while iterating locally.'),
					example('treeseed config --environment local --sync none --non-interactive', 'Apply deterministic local config in automation', 'Use the resolved current and suggested values without opening the interactive UI.'),
						example('treeseed config --environment staging --print-env-only', 'Inspect a resolved environment report', 'Print the resolved staging environment with secret values redacted and exit.'),
					example('treeseed config --rotate-machine-key', 'Rotate the local secret encryption key', 'Regenerate the machine key and re-encrypt locally stored Treeseed secrets.'),
				],
				optionDetails: [
					detail('--full', 'Enter the advanced editor directly instead of the startup wizard.'),
					detail('--mouse', 'Opt into terminal mouse capture for clicking, scrolling, and focus changes inside the config UI.'),
					detail('--environment <scope>', 'Filter configuration to `all`, `local`, `staging`, or `prod`.'),
					detail('--sync <mode>', 'Choose which provider surfaces should receive synchronized values after local updates are applied.'),
					detail('--non-interactive', 'Apply resolved values without opening the interactive editor. Use this for automation when you do not want `--json` output.'),
					detail('--install-missing-tooling', 'Allow config to install missing verification helpers such as the GitHub `gh-act` extension instead of only reporting them.'),
					detail('--print-env', 'Print the resolved environment values before remote initialization continues.'),
					detail('--print-env-only', 'Print the environment report and exit without interactive editing or remote initialization.'),
					detail('--rotate-machine-key', 'Rotate the local machine key used for encrypted Treeseed secret storage.'),
				],
				automationNotes: [
					'Use `--json` for machine-readable automation, or `--non-interactive` when you want deterministic application without interactive UI.',
					'`--print-env-only` and `--rotate-machine-key` are operational paths that bypass the interactive UI.',
					'Config reports missing tooling by default. Use `--install-missing-tooling` when you want the command to attempt installation.',
					'Shared versus scoped environment semantics are resolved inside the SDK; the CLI help should be treated as the operator-facing explanation layer.',
				],
				warnings: [
					'This command does not create branch preview deployments. Use `switch --preview` for task-preview lifecycle work.',
						'Secret values are always redacted. Reveal individual credentials only through their audited Service Vault ceremony.',
				],
				relatedDetails: [
					related('doctor', 'Use `doctor` when the problem is diagnostic uncertainty rather than direct environment editing.'),
					related('auth:login', 'Use `auth:login` when provider-backed operations fail because the CLI is not authenticated.'),
					related('run', 'Use `run` to reconcile the local platform and its exact desired seed set.'),
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
];
