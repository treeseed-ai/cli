import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const CLI_COMMAND_OVERLAYS_2: Array<[string, CommandOverlay]> = [
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
];
