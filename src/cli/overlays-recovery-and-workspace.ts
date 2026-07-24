import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const recoveryAndWorkspaceCommandOverlays: Array<[string, CommandOverlay]> = [
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
];
