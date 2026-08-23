import type { CommandContext, ParsedInvocation } from '../types.js';
import { invokeHostManager, invokeLocalHostManager } from '../support/host-client.js';
import { storeHostEnrollment, type HostEnrollment } from '../support/host-custody.js';

function input(invocation: ParsedInvocation) {
	if (invocation.command.execution.kind !== 'local') throw new Error('Host command is not locally bound.');
	const { server: _server, json: _json, yes: _yes, ...options } = invocation.options;
	return { handlerId: invocation.command.execution.handlerId, arguments: invocation.arguments, options };
}

export async function runHost(invocation: ParsedInvocation, context: CommandContext) {
	const command = input(invocation);
	if (invocation.options.plan === true && invocation.command.name === 'host bootstrap enroll') return { action: 'enroll', mutation: false, transport: 'local_socket' };
	if (invocation.command.name === 'host bootstrap enroll') {
		const enrollment = await (context.hostInvoke ? context.hostInvoke(command) : invokeLocalHostManager(command)) as HostEnrollment;
		const endpoint = typeof invocation.options.server === 'string' && invocation.options.server.includes('://')
			? invocation.options.server
			: context.env.TREESEED_HOST_URL ?? 'https://manager.treeseed.localhost';
		return storeHostEnrollment(enrollment, endpoint, context.env);
	}
	if (context.hostInvoke) return context.hostInvoke(command);
	return invokeHostManager(command, typeof invocation.options.server === 'string' ? invocation.options.server : undefined, context.env);
}
