import {
	ControlPlaneClient,
	defaultLocalControlPlaneServer,
	resolveControlPlaneServer,
	type ControlPlaneServerRegistry,
} from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { loadServerRegistry, loadServerSession, saveServerSession } from './server-custody.js';

export const CONTROL_PLANE_CLI_CLIENT_ID = 'trsd';

export async function createControlPlaneClient(invocation: Pick<ParsedInvocation, 'options'>, context: CommandContext, requireAuth = true) {
	const selector = typeof invocation.options.server === 'string' ? invocation.options.server : undefined;
	const stored = loadServerRegistry(context.env);
	const local = defaultLocalControlPlaneServer(context.env as Record<string, string | undefined>);
	const registry: ControlPlaneServerRegistry = {
		version: 1,
		activeServerId: stored.activeServerId || local.serverId,
		servers: [...stored.servers.filter((entry) => entry.serverId !== local.serverId), local],
	};
	const profile = resolveControlPlaneServer(selector, registry);
	let session = loadServerSession(profile.serverId, context.env);
	if (requireAuth && !session?.accessToken) throw Object.assign(new Error(`Not logged in to ${profile.serverId}. Run trsd auth login --server ${profile.serverId}.`), { category: 'authentication_required', code: 'authentication_required' });
	let client = new ControlPlaneClient({ profile, accessToken: session?.accessToken ?? null, userAgent: 'trsd' });
	if (requireAuth && session?.refreshToken && session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now() + 30_000) {
		const token = await client.refreshAccessToken(CONTROL_PLANE_CLI_CLIENT_ID, session.refreshToken);
		if (token.audience !== session.audience) throw Object.assign(new Error('Refreshed token audience does not match the stored server session.'), { category: 'authentication_required', code: 'oauth_audience_mismatch' });
		session = { serverId: profile.serverId, audience: token.audience, accessToken: token.accessToken, refreshToken: token.refreshToken ?? session.refreshToken, expiresAt: new Date(Date.now() + token.expiresIn * 1_000).toISOString(), principal: token.principal };
		saveServerSession(session, context.env);
		client = new ControlPlaneClient({ profile, accessToken: session.accessToken, userAgent: 'trsd' });
	}
	return {
		profile,
		session,
		client,
	};
}
