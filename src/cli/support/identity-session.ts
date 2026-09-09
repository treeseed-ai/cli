import { createPublicSessionClient, discoverResourceAuthorization, discoverSigningKeys } from '@treeseed/identity';
import { publicClientSessionBindingSchema } from '@treeseed/sdk/identity';
import type { ControlPlaneServerProfile, ControlPlaneServerSession } from '@treeseed/sdk/control-plane-client';
import { IDENTITY_CLIENT_ID } from './identity-login.js';

export function validateIdentitySession(profile:ControlPlaneServerProfile, session:ControlPlaneServerSession) {
	const binding = publicClientSessionBindingSchema.safeParse({identity:session.identity,clientId:session.clientId,scopes:session.scopes});
	if (!binding.success || session.clientId !== IDENTITY_CLIENT_ID || session.audience !== profile.baseUrl) {
		throw Object.assign(new Error(`Identity sign-in required for ${profile.serverId}. Run trsd auth login --server ${profile.serverId}.`), {category:'authentication_required',code:'identity_login_required'});
	}
	return binding.data;
}

export async function identitySessionClient(profile:ControlPlaneServerProfile, session:ControlPlaneServerSession) {
	const binding = validateIdentitySession(profile,session);
	await discoverResourceAuthorization({resource:session.audience,issuer:binding.identity.issuer,transport:fetch});
	return createPublicSessionClient({issuer:binding.identity.issuer,clientId:binding.clientId,resource:session.audience,scopes:binding.scopes,
		profile:'keycloak',transport:fetch,verificationKey:await discoverSigningKeys({issuer:binding.identity.issuer,transport:fetch}),
		resolvePrincipal:async identity => identity.issuer === binding.identity.issuer && identity.subject === binding.identity.subject
			? {principalId:session.principal?.id ?? identity.subject,kind:'human'} : null});
}
