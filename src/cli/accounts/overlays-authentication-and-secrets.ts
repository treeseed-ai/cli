import { DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from '../operations/operations-registry-support.ts';

export const authenticationAndSecretsCommandOverlays: Array<[string, CommandOverlay]> = [
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
	['auth:check', command({ examples: ['treeseed auth:check'], executionMode: 'adapter', buildAdapterInput: () => ({ requireAuth: true }) })],
];
