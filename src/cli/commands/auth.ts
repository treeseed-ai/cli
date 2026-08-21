import { clearMarketSession, setMarketSession } from '@treeseed/sdk/market-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient, sessionRoot } from '../support/client.js';
import { promptHidden, promptText } from '../support/prompts.js';

export async function runAuth(invocation: ParsedInvocation, context: CommandContext) {
	const { profile, client } = createControlPlaneClient(invocation, context, false);
	if (invocation.command.name === 'auth login') {
		const login = await promptText(context, 'Email or username: ');
		const password = await promptHidden('Password: ');
		const response = await client.webSignIn({ login, password });
		setMarketSession(sessionRoot(context), { marketId: profile.id, accessToken: response.payload.accessToken, refreshToken: response.payload.refreshToken ?? undefined, expiresAt: response.payload.expiresInSeconds ? new Date(Date.now() + response.payload.expiresInSeconds * 1000).toISOString() : undefined, principal: response.payload.principal });
		return { marketId: profile.id, principal: response.payload.principal };
	}
	if (invocation.command.name === 'auth logout') {
		if (createControlPlaneClient(invocation, context, false).session?.accessToken) await client.logout().catch(() => null);
		clearMarketSession(sessionRoot(context), profile.id);
		return { marketId: profile.id, loggedOut: true };
	}
	const response = await createControlPlaneClient(invocation, context, true).client.me();
	return { marketId: profile.id, ...response.payload };
}
