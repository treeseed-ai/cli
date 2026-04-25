import type { TreeseedCommandHandler } from '../types.js';
import {
	inspectTreeseedKeyAgentStatus,
	inspectTreeseedKeyAgentTransportDiagnostic,
	inspectTreeseedPassphraseEnvDiagnostic,
	lockTreeseedSecretSession,
	migrateTreeseedMachineKeyToWrapped,
	rotateTreeseedMachineKey,
	rotateTreeseedMachineKeyPassphrase,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	TreeseedKeyAgentError,
	unlockTreeseedSecretSessionFromEnv,
	unlockTreeseedSecretSessionInteractive,
} from '@treeseed/sdk/workflow-support';
import { fail, guidedResult } from './utils.js';
import { promptForNewPassphrase } from './secret-prompts.js';

async function renderStatus(command: string, tenantRoot: string) {
	const status = inspectTreeseedKeyAgentStatus(tenantRoot);
	const passphraseEnv = inspectTreeseedPassphraseEnvDiagnostic();
	const transport = await inspectTreeseedKeyAgentTransportDiagnostic();
	return guidedResult({
		command,
		summary: status.unlocked ? 'Treeseed secrets are unlocked.' : 'Treeseed secrets are locked.',
		facts: [
			{ label: 'Key agent', value: status.running ? 'running' : 'stopped' },
			{ label: 'Wrapped key', value: status.wrappedKeyPresent ? 'present' : 'missing' },
			{ label: 'Migration required', value: status.migrationRequired ? 'yes' : 'no' },
			{ label: 'Socket', value: transport.socketPresent ? 'present' : 'missing' },
			{ label: 'Socket connect', value: transport.socketConnectable ? 'yes' : 'no' },
			{ label: 'Socket health', value: transport.healthOk ? 'ok' : 'failed' },
			{ label: 'Idle timeout', value: `${Math.round(status.idleTimeoutMs / 1000)}s` },
			{ label: 'Idle remaining', value: `${Math.round(status.idleRemainingMs / 1000)}s` },
			{ label: 'Passphrase env', value: passphraseEnv.configured ? 'configured' : 'unset' },
			{ label: 'Key path', value: status.keyPath },
			{ label: 'Socket path', value: transport.socketPath },
		],
		report: {
			status,
			passphraseEnv,
			transport,
		},
		nextSteps: [
			...(passphraseEnv.configured ? [] : [passphraseEnv.recommendedLaunch]),
			...(transport.lastError ? [`Key-agent transport error: ${transport.lastError}`] : []),
		],
	});
}

function keyErrorResult(command: string, error: unknown) {
	if (error instanceof TreeseedKeyAgentError) {
		return guidedResult({
			command,
			summary: error.message,
			exitCode: 1,
			report: {
				code: error.code,
				details: error.details ?? null,
			},
			nextSteps: error.code === 'interactive_required'
				? ['Run this command in a TTY or set TREESEED_KEY_PASSPHRASE for the startup unlock path.']
				: undefined,
		});
	}
	return fail(error instanceof Error ? error.message : String(error));
}

export const handleSecretsStatus: TreeseedCommandHandler = async (_invocation, context) => renderStatus('secrets:status', context.cwd);

export const handleSecretsUnlock: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const fromEnv = invocation.args.fromEnv === true;
		const status = fromEnv
			? unlockTreeseedSecretSessionFromEnv(context.cwd, {
				allowMigration: invocation.args.allowMigration !== false,
				createIfMissing: invocation.args.createIfMissing !== false,
			})
			: (() => {
				if (!process.stdin.isTTY || !process.stdout.isTTY) {
					throw new TreeseedKeyAgentError(
						'interactive_required',
						'Treeseed secrets:unlock requires a TTY unless you use --from-env.',
					);
				}
				return unlockTreeseedSecretSessionInteractive(context.cwd);
			})();
		return guidedResult({
			command: 'secrets:unlock',
			summary: 'Treeseed secrets unlocked.',
			facts: [
				{ label: 'Key agent', value: status.running ? 'running' : 'stopped' },
				{ label: 'Idle remaining', value: `${Math.round(status.idleRemainingMs / 1000)}s` },
				{ label: 'Wrapped key', value: status.wrappedKeyPresent ? 'present' : 'missing' },
			],
			report: { status },
		});
	} catch (error) {
		return keyErrorResult('secrets:unlock', error);
	}
};

export const handleSecretsLock: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		const status = lockTreeseedSecretSession(context.cwd);
		return guidedResult({
			command: 'secrets:lock',
			summary: 'Treeseed secrets locked.',
			facts: [
				{ label: 'Key agent', value: status.running ? 'running' : 'stopped' },
				{ label: 'Wrapped key', value: status.wrappedKeyPresent ? 'present' : 'missing' },
			],
			report: { status },
		});
	} catch (error) {
		return keyErrorResult('secrets:lock', error);
	}
};

export const handleSecretsMigrateKey: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new TreeseedKeyAgentError('interactive_required', 'Treeseed secrets:migrate-key requires a TTY.');
		}
		const passphrase = await promptForNewPassphrase().catch((error) => {
			throw new TreeseedKeyAgentError('unlock_failed', error instanceof Error ? error.message : String(error));
		});
		const result = migrateTreeseedMachineKeyToWrapped(context.cwd, passphrase);
		return guidedResult({
			command: 'secrets:migrate-key',
			summary: result.alreadyWrapped ? 'Treeseed machine key is already wrapped.' : 'Treeseed machine key migrated to the wrapped format.',
			facts: [
				{ label: 'Key path', value: result.keyPath },
				{ label: 'Migrated', value: result.migrated ? 'yes' : 'no' },
			],
			report: result,
		});
	} catch (error) {
		return keyErrorResult('secrets:migrate-key', error);
	}
};

export const handleSecretsRotatePassphrase: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new TreeseedKeyAgentError('interactive_required', 'Treeseed secrets:rotate-passphrase requires a TTY.');
		}
		const passphrase = await promptForNewPassphrase().catch((error) => {
			throw new TreeseedKeyAgentError('unlock_failed', error instanceof Error ? error.message : String(error));
		});
		const result = rotateTreeseedMachineKeyPassphrase(context.cwd, passphrase);
		return guidedResult({
			command: 'secrets:rotate-passphrase',
			summary: 'Treeseed machine-key passphrase rotated.',
			facts: [{ label: 'Key path', value: result.keyPath }],
			report: result,
		});
	} catch (error) {
		return keyErrorResult('secrets:rotate-passphrase', error);
	}
};

export const handleSecretsRotateMachineKey: TreeseedCommandHandler = async (_invocation, context) => {
	try {
		if (!process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV]?.trim()) {
			throw new TreeseedKeyAgentError(
				'interactive_required',
				`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} before rotating the machine key.`,
			);
		}
		const result = rotateTreeseedMachineKey(context.cwd);
		return guidedResult({
			command: 'secrets:rotate-machine-key',
			summary: 'Treeseed machine key rotated and re-encrypted.',
			facts: [{ label: 'Key path', value: result.keyPath }],
			report: result,
		});
	} catch (error) {
		return keyErrorResult('secrets:rotate-machine-key', error);
	}
};
