import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createDeviceAuthorizationClient, createNativeOidcClient, discoverResourceAuthorization, discoverSigningKeys, type NativeOidcOptions } from '@treeseed/identity';
import type { CommandContext } from '../types.js';

export const IDENTITY_CLIENT_ID = 'trsd';
export const IDENTITY_SCOPES = ['treeseed:read', 'treeseed:knowledge:write', 'treeseed:governance:write', 'treeseed:projects:write', 'treeseed:execution'];
type LoginResult = Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof createNativeOidcClient>>['begin']>>['finish']>>;

async function showAuthorization(url: string, context: CommandContext) {
	const opened = await Promise.resolve(context.openExternal?.(url)).catch(() => false);
	context.write(opened ? 'Opened your browser for sign-in.' : `Open this address to sign in: ${url}`, 'stderr');
}

async function nativeLogin(options: Omit<NativeOidcOptions, 'redirectUri'>, context: CommandContext, timeoutSeconds: number): Promise<LoginResult> {
	let pending: Awaited<ReturnType<Awaited<ReturnType<typeof createNativeOidcClient>>['begin']>> | undefined;
	let receive: (result: LoginResult | null) => void = () => {};
	let redirectUri = '';
	const server = createServer(async (request, response) => {
		response.setHeader('cache-control','no-store');
		response.setHeader('content-type','text/plain; charset=utf-8');
		try {
			if (!pending || request.method !== 'GET' || request.headers.host !== new URL(redirectUri).host) throw new Error();
			const result = await pending.finish(new URL(request.url ?? '/', redirectUri));
			response.end('Signed in. You can close this window.'); receive(result);
		} catch { response.writeHead(400); response.end('Invalid sign-in callback. Return to the CLI.'); }
	});
	server.requestTimeout = 10000; server.headersTimeout = 10000;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await new Promise<void>((resolve, reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
		const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local sign-in listener unavailable. Use --device.');
		redirectUri = `http://127.0.0.1:${address.port}/callback`;
		pending = await (await createNativeOidcClient({...options, redirectUri})).begin();
		const completed = new Promise<LoginResult | null>(resolve => {
			receive = resolve; timer = setTimeout(() => resolve(null), Math.min(timeoutSeconds * 1000, pending!.expiresAt - Date.now()));
		});
		await showAuthorization(pending.authorizationUrl, context);
		const result = await completed;
		if (!result) throw new Error('Sign-in timed out. Retry, or use --device for a headless session.');
		return result;
	} finally {
		if (timer) clearTimeout(timer); pending?.cancel();
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
}

export async function identityLogin(input: {resource:string; issuer?:string; device:boolean; timeoutSeconds:number}, context:CommandContext): Promise<LoginResult> {
	const selected = await discoverResourceAuthorization({resource:input.resource, issuer:input.issuer, transport:fetch});
	if (IDENTITY_SCOPES.some(scope => !selected.scopesSupported.includes(scope))) throw new Error('The selected API does not advertise the required TreeSeed login scopes.');
	const options = {issuer:selected.issuer, clientId:IDENTITY_CLIENT_ID, resource:selected.resource, scopes:IDENTITY_SCOPES,
		verificationKey:await discoverSigningKeys({issuer:selected.issuer, transport:fetch}), profile:'keycloak' as const, transport:fetch,
		resolvePrincipal:async (identity: {subject:string}) => ({principalId:identity.subject,kind:'human' as const})};
	if (!input.device) return nativeLogin(options, context, input.timeoutSeconds);
	const pending = await (await createDeviceAuthorizationClient({...options, resources:[selected.resource]})).begin({resource:selected.resource, scopes:IDENTITY_SCOPES});
	try {
		await showAuthorization(pending.verificationUriComplete ?? pending.verificationUri, context);
		if (!pending.verificationUriComplete) context.write(`Enter code ${pending.userCode}.`,'stderr');
		const deadline = Math.min(pending.expiresAt, Date.now() + input.timeoutSeconds * 1000);
		while (Date.now() < deadline) {
			const result = await pending.poll();
			if (result.status === 'authorized') return result;
			if (result.status !== 'pending') throw new Error(`Identity sign-in ${result.status}. Start a new login.`);
			await delay(Math.min(Math.max(1,result.nextPollAt - Date.now()), Math.max(1,deadline - Date.now())));
		}
		throw new Error('Identity sign-in timed out. Start a new login.');
	} finally { pending.cancel(); }
}
