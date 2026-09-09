import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { IDENTITY_SCOPES } from '../../src/cli/support/identity-login.ts';

export const identityIssuer = 'https://identity.example.test/realms/local';
export const apiResource = 'https://api.example.test';
export const sessionBinding = {identity:{issuer:identityIssuer,subject:'subject'},clientId:'trsd',scopes:IDENTITY_SCOPES};

export async function identityFixture() {
	const keys = await generateKeyPair('RS256');
	const jwk = {...await exportJWK(keys.publicKey),kid:'fixture'};
	let nonce = '';
	const state = {tokenCalls:0,rejectRenewal:false,subject:'subject',audience:apiResource};
	const transport: typeof fetch = async (input,init) => {
		const url = String(input);
		if (url === `${apiResource}/.well-known/oauth-protected-resource`) return Response.json({resource:apiResource,authorization_servers:[identityIssuer],scopes_supported:IDENTITY_SCOPES});
		if (url === `${identityIssuer}/.well-known/openid-configuration`) return Response.json({issuer:identityIssuer,jwks_uri:`${identityIssuer}/certs`,authorization_endpoint:`${identityIssuer}/authorize`,
			token_endpoint:`${identityIssuer}/token`,revocation_endpoint:`${identityIssuer}/revoke`,device_authorization_endpoint:`${identityIssuer}/device`,code_challenge_methods_supported:['S256']});
		if (url === `${identityIssuer}/certs`) return Response.json({keys:[jwk]});
		if (url === `${identityIssuer}/device`) return Response.json({device_code:'private-device',user_code:'USER-CODE',verification_uri:`${identityIssuer}/approve`,expires_in:60,interval:1});
		if (url === `${identityIssuer}/revoke`) return new Response(null,{status:200});
		if (url === `${identityIssuer}/token`) {
			state.tokenCalls++;
			const body = new URLSearchParams(String(init?.body));
			if (state.rejectRenewal && body.get('grant_type') === 'refresh_token') return Response.json({error:'temporarily_unavailable'},{status:503});
			const now = Math.floor(Date.now()/1000);
			const sign = (claims:Record<string,unknown>) => new SignJWT({iss:identityIssuer,sub:state.subject,iat:now,exp:now+300,...claims}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(keys.privateKey);
			const access_token = await sign({aud:state.audience,typ:'Bearer',azp:'trsd',scope:IDENTITY_SCOPES.join(' ')});
			return Response.json({access_token,refresh_token:'rotated',token_type:'Bearer',expires_in:300,scope:IDENTITY_SCOPES.join(' '),
				...(body.get('grant_type') === 'authorization_code' ? {id_token:await sign({aud:'trsd',nonce})} : {})});
		}
		if (url === `${apiResource}/v1/me`) return Response.json({data:{principal:{id:'local-user',displayName:'Test User'},teams:[]}});
		throw new Error(`Unexpected synthetic identity request: ${new URL(url).pathname}`);
	};
	return {state,transport,authorize(url:string) {
		const request = new URL(url); nonce = request.searchParams.get('nonce')!;
		const callback = new URL(request.searchParams.get('redirect_uri')!);
		callback.searchParams.set('code','synthetic-code'); callback.searchParams.set('state',request.searchParams.get('state')!);
		return callback;
	}};
}
