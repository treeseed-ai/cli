import { ControlPlaneClient } from '@treeseed/sdk/control-plane-client';
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';
import { updateServerSession, saveServerProfile, saveServerSession } from '../support/server-custody.js';
import { identityLogin, IDENTITY_CLIENT_ID, requestedIdentityScopes, grantedIdentityScopes } from '../support/identity-login.js';
import { identitySessionClient } from '../support/identity-session.js';

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function teamsFrom(value: unknown) {
	const source = record(value); const values = Array.isArray(source.teams) ? source.teams : Array.isArray(source.items) ? source.items : [];
	return values.map(record).flatMap(team => {
		const id = String(team.id ?? '').trim(), slug = String(team.slug ?? '').trim(), name = String(team.name ?? team.displayName ?? slug).trim();
		return id && slug ? [{id,slug,name}] : [];
	});
}

export async function runAuth(invocation: ParsedInvocation, context: CommandContext) {
	const {profile, session} = await createControlPlaneClient(invocation, context, false);
	if (invocation.command.name === 'auth login') {
		const timeoutSeconds = Number(invocation.options.timeout ?? context.env.TREESEED_CLI_LOGIN_TIMEOUT_SECONDS ?? 300);
		if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 3600) throw new Error('--timeout must be between 1 and 3600 seconds.');
		const requestedScopes = requestedIdentityScopes(invocation.options.scope);
		const result = await identityLogin({resource:profile.baseUrl, issuer:typeof invocation.options.issuer === 'string' ? invocation.options.issuer : undefined,
			device:invocation.options.device === true, timeoutSeconds, scopes:requestedScopes}, context);
		const scopes = grantedIdentityScopes(requestedScopes, result.tokens.scope);
		const client = new ControlPlaneClient({profile,accessToken:result.tokens.access_token,userAgent:'trsd'});
		const current = await client.invoke(CONTROL_PLANE_OPERATIONS.accounts.current, {path:{},query:{},body:undefined});
		const principal = record(current.data).principal;
		if (!principal || typeof principal !== 'object' || !('id' in principal) || typeof principal.id !== 'string') throw new Error('The API has no local principal mapping for this identity.');
		const teams = teamsFrom(current.data), prior = session?.activeTeam;
		const sameIdentity = session?.identity?.issuer === result.principal.identity.issuer && session?.identity?.subject === result.principal.identity.subject;
		const activeTeam = sameIdentity && prior && teams.some(team => team.id === prior.id) ? teams.find(team => team.id === prior.id)! : teams.length === 1 ? teams[0]! : null;
		if (!Number.isFinite(result.tokens.expires_in) || result.tokens.expires_in! <= 0) throw new Error('Identity did not return a bounded access-token lifetime.');
		const expiresAt = new Date(Date.now() + result.tokens.expires_in! * 1000).toISOString();
		saveServerProfile(profile, context.env);
		await saveServerSession({serverId:profile.serverId, audience:result.resource, identity:result.principal.identity, clientId:IDENTITY_CLIENT_ID,
			scopes, accessToken:result.tokens.access_token, refreshToken:result.tokens.refresh_token, expiresAt,
			principal:principal as NonNullable<typeof session>['principal'], activeTeam}, context.env);
		return {serverId:profile.serverId, principal, identity:result.principal.identity, activeTeam, expiresAt, scopes};
	}
	if (invocation.command.name === 'auth logout') {
		let upstreamRevoked = false;
		await updateServerSession(profile.serverId,context.env,async current => {
			const token = current?.refreshToken ?? current?.accessToken;
			if (current && token) {
				try { await (await identitySessionClient(profile,current)).revoke(token); upstreamRevoked = true; }
				catch { /* Local logout must still succeed; never retry ambiguous revocation. */ }
			}
			return null;
		});
		return {serverId:profile.serverId,loggedOut:true,upstreamRevoked};
	}
	throw new Error(`Unknown identity command: ${invocation.command.name}`);
}
