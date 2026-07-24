import type { TreeseedOperationSpec } from './operations-types.ts';
import {
	devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS,
} from './operations-registry-support.ts';

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

export const localDevelopmentOperationSpecs: TreeseedOperationSpec[] = [
	...DEV_MANAGED_OPERATION_SPECS,
];
