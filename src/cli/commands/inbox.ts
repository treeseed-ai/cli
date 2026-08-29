import { defaultLocalControlPlaneServer, resolveControlPlaneServer } from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { runInteractiveInbox } from '../inbox/interactive-inbox.js';
import { loadServerRegistry, loadServerSession } from '../support/server-custody.js';

function activeTeam(invocation: ParsedInvocation, context: CommandContext) {
	const local=defaultLocalControlPlaneServer(context.env as Record<string,string|undefined>),stored=loadServerRegistry(context.env);
	const registry={version:1 as const,activeServerId:stored.activeServerId||local.serverId,servers:[...stored.servers.filter(entry=>entry.serverId!==local.serverId),local]};
	const server=resolveControlPlaneServer(typeof invocation.options.server==='string'?invocation.options.server:undefined,registry);
	return loadServerSession(server.serverId,context.env)?.activeTeam?.id;
}
export async function runInbox(invocation:ParsedInvocation,context:CommandContext){const teamId=activeTeam(invocation,context);if(!teamId)throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before opening the inbox.'),{category:'ambiguous_context',code:'team_required'});return runInteractiveInbox(invocation,context,teamId);}
