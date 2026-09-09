import {
	ControlPlaneClient,
	defaultLocalControlPlaneServer,
	resolveControlPlaneServer,
	type ControlPlaneServerRegistry,
} from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { loadServerRegistry, loadServerSession, updateServerSession } from './server-custody.js';

export const CONTROL_PLANE_CLI_CLIENT_ID = 'trsd';

export function controlPlaneServerRegistry(context: Pick<CommandContext, 'env'>): ControlPlaneServerRegistry {
	const stored = loadServerRegistry(context.env);
	const defaultLocal = defaultLocalControlPlaneServer(context.env as Record<string, string | undefined>);
	const storedLocal = stored.servers.find((entry) => entry.serverId === defaultLocal.serverId);
	const hasEnvironmentOverride = Boolean(context.env.TREESEED_API_BASE_URL?.trim());
	const local = hasEnvironmentOverride || !storedLocal ? defaultLocal : storedLocal;
	return {
		version: 1,
		activeServerId: stored.activeServerId || local.serverId,
		servers: [...stored.servers.filter((entry) => entry.serverId !== local.serverId), local],
	};
}

export async function createControlPlaneClient(invocation: Pick<ParsedInvocation, 'options'>, context: CommandContext, requireAuth = true, forceRefresh = false) {
	const selector = typeof invocation.options.server === 'string' ? invocation.options.server : undefined;
	const registry = controlPlaneServerRegistry(context);
	const profile = resolveControlPlaneServer(selector, registry);
	let session = loadServerSession(profile.serverId, context.env);
	if (requireAuth && !session?.accessToken) throw Object.assign(new Error(`Not logged in to ${profile.serverId}. Run trsd auth login --server ${profile.serverId}.`), { category: 'authentication_required', code: 'authentication_required' });
	let client = new ControlPlaneClient({ profile, accessToken: session?.accessToken ?? null, userAgent: 'trsd' });
	if (requireAuth && session?.refreshToken && (forceRefresh || (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now() + 30_000))) {
		const observedRefresh = session.refreshToken;
		session = await updateServerSession(profile.serverId, context.env, async current => {
			if (!current?.accessToken || !current.refreshToken) throw Object.assign(new Error('Session ended before renewal. Log in again.'), { category: 'authentication_required', code: 'authentication_required' });
			const expired = current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now() + 30_000;
			if (!expired && (!forceRefresh || current.refreshToken !== observedRefresh)) return current;
			const refreshingClient = new ControlPlaneClient({ profile, accessToken: current.accessToken, userAgent: 'trsd' });
			const token = await refreshingClient.refreshAccessToken(CONTROL_PLANE_CLI_CLIENT_ID, current.refreshToken, AbortSignal.timeout(10_000));
			if (token.audience !== current.audience) throw Object.assign(new Error('Refreshed token audience does not match the stored server session.'), { category: 'authentication_required', code: 'oauth_audience_mismatch' });
			return { serverId: profile.serverId, audience: token.audience, accessToken: token.accessToken, refreshToken: token.refreshToken ?? current.refreshToken, expiresAt: new Date(Date.now() + token.expiresIn * 1_000).toISOString(), principal: token.principal, activeTeam: current.activeTeam ?? null };
		}, true);
		if (!session) throw new Error('Session ended during renewal. Log in again.');
		client = new ControlPlaneClient({ profile, accessToken: session.accessToken, userAgent: 'trsd' });
	}
	return {
		profile,
		session,
		client,
	};
}
