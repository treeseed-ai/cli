import type { CommandContext, ParsedInvocation } from '../types.js';
import { inspectServerCustody, lockServerCustody, unlockServerCustody } from '../support/server-custody.js';

export async function runSecrets(invocation: ParsedInvocation, context: CommandContext) {
	switch (invocation.command.name) {
		case 'secrets list':
		case 'secrets status':
			return inspectServerCustody(context.env);
		case 'secrets unlock':
			return unlockServerCustody(context.env);
		case 'secrets lock':
			return lockServerCustody(context.env);
		default:
			throw new Error(`Unknown local secret command: ${invocation.command.name}`);
	}
}
