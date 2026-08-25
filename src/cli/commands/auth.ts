import { setTimeout as delay } from 'node:timers/promises';
import type { OAuthScope } from '@treeseed/sdk/operator-contracts';
import { ControlPlaneClient, ControlPlaneClientError } from '@treeseed/sdk/control-plane-client';
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { CONTROL_PLANE_CLI_CLIENT_ID, createControlPlaneClient } from '../support/client.js';
import { clearServerSession, saveServerProfile, saveServerSession } from '../support/server-custody.js';

const DEFAULT_SCOPES: OAuthScope[] = ['treeseed:read', 'treeseed:knowledge:write', 'treeseed:governance:write', 'treeseed:projects:write', 'treeseed:execution'];
const DEFAULT_LOGIN_TIMEOUT_SECONDS = 300;

function configuredLoginTimeoutSeconds(invocation: ParsedInvocation, context: CommandContext) {
	const configured = invocation.options.timeout ?? context.env.TREESEED_CLI_LOGIN_TIMEOUT_SECONDS
		?? context.env.TREESEED_CLI_OPERATION_TIMEOUT_SECONDS ?? DEFAULT_LOGIN_TIMEOUT_SECONDS;
	const value = Number(configured);
	if (!Number.isFinite(value) || value <= 0 || value > 3_600) throw Object.assign(new Error('--timeout must be between 1 and 3600 seconds.'), { category: 'invalid_input', code: 'invalid_timeout' });
	return value;
}

function pollingState(error: unknown) {
	if (!(error instanceof ControlPlaneClientError)) return 'failed' as const;
	if (error.problem.code === 'slow_down') return 'slow_down' as const;
	if (error.problem.code === 'authorization_pending' || /authorization.pending/iu.test(error.message)) return 'pending' as const;
	return 'failed' as const;
}

export async function runAuth(invocation: ParsedInvocation, context: CommandContext) {
	const { profile, session, client } = await createControlPlaneClient(invocation, context, false);
	if (invocation.command.name === 'auth login') {
		const configuredTimeout = configuredLoginTimeoutSeconds(invocation, context);
		const authorization = await client.authorizeDevice(CONTROL_PLANE_CLI_CLIENT_ID, DEFAULT_SCOPES, AbortSignal.timeout(configuredTimeout * 1_000));
		context.write(`Open ${authorization.verificationUriComplete ?? authorization.verificationUri} and enter code ${authorization.userCode}.`, 'stderr');
		const timeoutSeconds = Math.min(configuredTimeout, authorization.expiresIn);
		const deadline = Date.now() + timeoutSeconds * 1_000;
		let interval = Math.max(1, authorization.interval) * 1_000;
		while (Date.now() < deadline) {
			try {
				const token = await client.exchangeDeviceCode(CONTROL_PLANE_CLI_CLIENT_ID, authorization.deviceCode);
				const expiresAt = new Date(Date.now() + token.expiresIn * 1_000).toISOString();
				const authenticatedClient = new ControlPlaneClient({ profile, accessToken: token.accessToken, userAgent: 'trsd' });
				const current = await authenticatedClient.invoke(CONTROL_PLANE_OPERATIONS.accounts.current, { path: {}, query: {}, body: undefined });
				const principal = current.data && typeof current.data === 'object' && 'principal' in current.data
					? current.data.principal as typeof token.principal : token.principal;
				saveServerProfile(profile, context.env);
				saveServerSession({ serverId: profile.serverId, audience: token.audience, accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt, principal }, context.env);
				return { serverId: profile.serverId, principal: principal ?? null, expiresAt, scopes: token.scope };
			} catch (error) {
				const state = pollingState(error);
				if (state === 'failed') throw error;
				if (state === 'slow_down') interval += 5_000;
				await delay(Math.min(interval, Math.max(1, deadline - Date.now())));
			}
		}
		throw Object.assign(new Error(`Device authorization was not approved within ${timeoutSeconds} seconds.`), { category: 'authentication_required', code: 'device_authorization_timeout' });
	}
	if (invocation.command.name === 'auth logout') {
		const token = session?.refreshToken ?? session?.accessToken;
		if (token) await client.revokeToken(CONTROL_PLANE_CLI_CLIENT_ID, token).catch(() => undefined);
		clearServerSession(profile.serverId, context.env);
		return { serverId: profile.serverId, loggedOut: true };
	}
	throw new Error(`Unknown OAuth protocol command: ${invocation.command.name}`);
}
