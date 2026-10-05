import { resolveControlPlaneServer } from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { launchApplication } from '../application/launch.js';
import { controlPlaneServerRegistry } from '../support/client.js';
import { loadServerSession } from '../support/server-custody.js';

function activeTeam(invocation: ParsedInvocation, context: CommandContext) {
	const registry=controlPlaneServerRegistry(context);
	const server=resolveControlPlaneServer(typeof invocation.options.server==='string'?invocation.options.server:undefined,registry);
	return loadServerSession(server.serverId,context.env)?.activeTeam?.id;
}
export async function runInbox(invocation:ParsedInvocation,context:CommandContext){const teamId=activeTeam(invocation,context);if(!teamId)throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before opening the inbox.'),{category:'ambiguous_context',code:'team_required'});return launchApplication(context,{server:typeof invocation.options.server==='string'?invocation.options.server:undefined,workspace:'inbox'});}
