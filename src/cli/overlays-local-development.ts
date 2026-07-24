import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const localDevelopmentCommandOverlays: Array<[string, CommandOverlay]> = [
	['destroy', command({
			usage: 'treeseed destroy --environment <local|staging|prod> [--plan] [--delete-data] [--sweep-treeseed] [--force] [--skip-confirmation] [--confirm <slug>] [--remove-build-artifacts]',
			options: [
				{ name: 'environment', flags: '--environment <scope>', description: 'Select the persistent environment to destroy.', kind: 'enum', values: ['local', 'staging', 'prod'] },
				{ name: 'plan', flags: '--plan', description: 'Compute the destroy plan without mutating the environment.', kind: 'boolean' },
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
];
