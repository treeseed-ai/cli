import {
	inspectKeyAgentStatus,
	lockSecretSession,
	rotateMachineKeyPassphrase,
	unlockSecretSessionFromEnv,
	unlockSecretSessionInteractive,
} from '@treeseed/sdk/workflow-support';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { promptHidden } from '../support/prompts.js';

async function newPassphrase() {
	const passphrase = (await promptHidden('New TreeSeed passphrase: ')).trim();
	const confirmation = (await promptHidden('Confirm passphrase: ')).trim();
	if (!passphrase || passphrase !== confirmation) throw new Error('The passphrase confirmation did not match.');
	return passphrase;
}

export async function runSecrets(invocation: ParsedInvocation, context: CommandContext) {
	switch (invocation.command.name) {
		case 'secrets list': case 'secrets status': return inspectKeyAgentStatus(context.cwd);
		case 'secrets unlock': return context.env.TREESEED_KEY_PASSPHRASE ? unlockSecretSessionFromEnv(context.cwd, { allowMigration: true, createIfMissing: true }) : unlockSecretSessionInteractive(context.cwd);
		case 'secrets lock': return lockSecretSession(context.cwd);
		case 'secrets rotate': return rotateMachineKeyPassphrase(context.cwd, await newPassphrase());
		default: throw new Error(`Unknown local secret command: ${invocation.command.name}`);
	}
}
