import {
	findOperation,
	listOperationNames,
	TRESEED_OPERATION_SPECS,
} from '../operations/operations-registry.js';
import type { CommandSpec } from '../operations/operations-types.js';
import { handleAuthLogin } from '../handlers/accounts/auth-login.js';
import { handleAuthLogout } from '../handlers/accounts/auth-logout.js';
import { handleAuthWhoAmI } from '../handlers/accounts/auth-whoami.js';
import {
	handleSecretsLock,
	handleSecretsRotatePassphrase,
	handleSecretsStatus,
	handleSecretsUnlock,
} from '../handlers/configuration/secrets.js';
import { handleStatus } from '../handlers/diagnostics/status.js';
import { handleDoctor } from '../handlers/diagnostics/doctor.js';
import { handleOperatorCommand } from '../handlers/operator/operator-command.js';

export const COMMAND_HANDLERS = {
	operator: handleOperatorCommand,
	authLogin: handleAuthLogin,
	authLogout: handleAuthLogout,
	authWhoAmI: handleAuthWhoAmI,
	secretsStatus: handleSecretsStatus,
	secretsUnlock: handleSecretsUnlock,
	secretsLock: handleSecretsLock,
	secretsRotatePassphrase: handleSecretsRotatePassphrase,
	status: handleStatus,
	doctor: handleDoctor,
} as const;

export const TRESEED_COMMAND_SPECS: CommandSpec[] = TRESEED_OPERATION_SPECS;

export function findCommandSpec(name: string | null | undefined) {
	return findOperation(name);
}

export function listCommandNames() {
	return listOperationNames();
}
