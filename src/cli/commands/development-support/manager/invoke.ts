import type { CommandContext } from '../../../types.ts';
import { invokeLocalHostManager } from '../../../support/host-client.js';

function hostCommand(handlerId: string, payload: unknown) {
	return { handlerId, arguments: [], options: { payload: JSON.stringify(payload) } };
}

export async function invokeDevelopmentManager(context: CommandContext, handlerId: string, payload: unknown) {
	const command = hostCommand(handlerId, payload);
	return context.hostInvoke ? context.hostInvoke(command) : invokeLocalHostManager(command);
}
