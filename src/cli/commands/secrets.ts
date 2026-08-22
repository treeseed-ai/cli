import type { CommandContext, ParsedInvocation } from '../types.js';
import { inspectServerCustody, rotateServerCustodyKey } from '../support/server-custody.js';

export async function runSecrets(invocation: ParsedInvocation, context: CommandContext) {
	switch (invocation.command.name) {
		case 'secrets list':
		case 'secrets status':
			return inspectServerCustody(context.env);
		case 'secrets unlock':
			return { ...inspectServerCustody(context.env), unlockedForProcess: true, retainedPlaintext: false };
		case 'secrets lock':
			return { locked: true, retainedPlaintext: false };
		case 'secrets rotate':
			return rotateServerCustodyKey(context.env);
		default:
			throw new Error(`Unknown local secret command: ${invocation.command.name}`);
	}
}
