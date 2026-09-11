import {
	ControlPlaneClient,
	defaultLocalControlPlaneServer,
	resolveControlPlaneServer,
	type ControlPlaneServerRegistry,
} from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { loadServerRegistry, loadServerSession, updateServerSession } from './server-custody.js';
import { identitySessionClient, validateIdentitySession } from './identity-session.js';

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
	if (requireAuth && session) validateIdentitySession(profile, session);
	let client = new ControlPlaneClient({ profile, accessToken: session?.accessToken ?? null, userAgent: 'trsd' });
	if (requireAuth && session?.refreshToken && (forceRefresh || (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now() + 30_000))) {
		const observedRefresh = session.refreshToken;
		let refreshStarted = false;
		session = await updateServerSession(profile.serverId, context.env, async current => {
			if (!current?.accessToken || !current.refreshToken) throw Object.assign(new Error('Session ended before renewal. Log in again.'), { category: 'authentication_required', code: 'authentication_required' });
			validateIdentitySession(profile,current);
			const expired = current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now() + 30_000;
			if (!expired && (!forceRefresh || current.refreshToken !== observedRefresh)) return current;
			const identityClient = await identitySessionClient(profile,current);
			// Discovery has not submitted credentials. Only a refresh attempt can rotate the saved token.
			refreshStarted = true;
			const result = await identityClient.refresh(current.refreshToken,current.identity);
			if (!Number.isFinite(result.tokens.expires_in) || result.tokens.expires_in! <= 0) throw new Error('Identity did not return a bounded token lifetime.');
			return { ...current, accessToken:result.tokens.access_token, refreshToken:result.tokens.refresh_token ?? current.refreshToken,
				expiresAt:new Date(Date.now() + result.tokens.expires_in! * 1000).toISOString() };
		}, () => refreshStarted);
		if (!session) throw new Error('Session ended during renewal. Log in again.');
		client = new ControlPlaneClient({ profile, accessToken: session.accessToken, userAgent: 'trsd' });
	}
	return {
		profile,
		session,
		client,
	};
}
