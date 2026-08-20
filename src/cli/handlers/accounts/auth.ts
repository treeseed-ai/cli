import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { setMarketSession, type MarketWebAuthSession } from '@treeseed/sdk/market-client';
import type { CommandContext, CommandHandler, ParsedInvocation } from '../../types.js';
import { promptHidden } from '../configuration/secret-prompts.js';
import { createMarketClientForInvocation, marketAuthRoot } from '../content/market-utils.js';
import { guidedResult } from '../utilities/utils.js';
import { handleAuthLogin } from './auth-login.js';
import { handleAuthLogout } from './auth-logout.js';
import { handleAuthWhoAmI } from './auth-whoami.js';

function value(input: unknown) {
	return typeof input === 'string' ? input.trim() : '';
}

function secretInputAllowed(context: CommandContext) {
	return context.interactiveUi !== false
		&& context.outputFormat !== 'json'
		&& process.stdin.isTTY === true
		&& process.stdout.isTTY === true;
}

function requireSecretInput(context: CommandContext) {
	if (!secretInputAllowed(context)) {
		throw new Error('This action requires an interactive TTY so secrets are entered silently. Passwords and tokens are never accepted as command options or JSON input.');
	}
}

async function promptText(context: CommandContext, question: string) {
	if (context.prompt) return value(await context.prompt(question));
	if (context.interactiveUi === false || !stdin.isTTY || !stdout.isTTY) {
		throw new Error(`Missing required value. ${question.trim()}`);
	}
	const prompt = readline.createInterface({ input: stdin, output: stdout });
	try {
		return value(await prompt.question(question));
	} finally {
		prompt.close();
	}
}

async function passwordWithConfirmation(context: CommandContext, label = 'Password') {
	requireSecretInput(context);
	const password = await promptHidden(`${label}: `);
	const confirmation = await promptHidden(`Confirm ${label.toLowerCase()}: `);
	if (password.length < 12) throw new Error('Password must be at least 12 characters.');
	if (password !== confirmation) throw new Error('Password confirmation did not match.');
	return password;
}

function storeSession(invocation: ParsedInvocation, context: CommandContext, session: MarketWebAuthSession) {
	const { profile } = createMarketClientForInvocation(invocation, context);
	const expiresAt = typeof session.expiresInSeconds === 'number'
		? new Date(Date.now() + session.expiresInSeconds * 1000).toISOString()
		: undefined;
	setMarketSession(marketAuthRoot(context), {
		marketId: profile.id,
		accessToken: session.accessToken,
		refreshToken: session.refreshToken ?? undefined,
		expiresAt,
		principal: session.principal,
	});
	return profile;
}

async function register(invocation: ParsedInvocation, context: CommandContext) {
	const email = value(invocation.args.email) || await promptText(context, 'Email: ');
	const username = value(invocation.args.username) || await promptText(context, 'Username: ');
	const name = value(invocation.args.name) || await promptText(context, 'Display name: ');
	if (!email || !username || !name) throw new Error('Email, username, and display name are required.');
	const password = await passwordWithConfirmation(context);
	const { profile, client } = createMarketClientForInvocation(invocation, context);
	const response = await client.webSignUp({ email, username, name, password });
	return guidedResult({
		command: 'auth register',
		summary: 'TreeSeed account registration created. Email confirmation is required before password sign-in.',
		facts: [{ label: 'Market', value: profile.id }, { label: 'Email', value: email }],
		nextSteps: [
			profile.id === 'local' ? 'Open local Mailpit at http://127.0.0.1:8025 and copy the confirmation token or link.' : 'Open the confirmation email sent by TreeSeed.',
			'Run `trsd auth confirm-email --market ' + profile.id + '` and enter the token silently.',
		],
		report: { marketId: profile.id, baseUrl: profile.baseUrl, confirmationRequired: true },
	});
}

async function confirmEmail(invocation: ParsedInvocation, context: CommandContext) {
	requireSecretInput(context);
	const token = value(await promptHidden('Email confirmation token: '));
	if (!token) throw new Error('Email confirmation token is required.');
	const { client } = createMarketClientForInvocation(invocation, context);
	const response = await client.confirmWebEmail({ token });
	const profile = storeSession(invocation, context, response.payload);
	return guidedResult({
		command: 'auth confirm-email',
		summary: 'Email confirmed and human CLI session established.',
		facts: [{ label: 'Market', value: profile.id }, { label: 'Principal', value: response.payload.principal.displayName ?? response.payload.principal.id }],
		report: { marketId: profile.id, baseUrl: profile.baseUrl, principal: response.payload.principal },
	});
}

async function passwordLogin(invocation: ParsedInvocation, context: CommandContext) {
	const login = value(invocation.args.login) || value(invocation.args.email) || value(invocation.args.username)
		|| await promptText(context, 'Email or username: ');
	requireSecretInput(context);
	const password = await promptHidden('Password: ');
	if (!login || !password) throw new Error('Email or username and password are required.');
	const { client } = createMarketClientForInvocation(invocation, context);
	const response = await client.webSignIn({ login, password });
	const profile = storeSession(invocation, context, response.payload);
	return guidedResult({
		command: 'auth login',
		summary: 'Human CLI login completed successfully.',
		facts: [{ label: 'Market', value: profile.id }, { label: 'Principal', value: response.payload.principal.displayName ?? response.payload.principal.id }],
		report: { marketId: profile.id, baseUrl: profile.baseUrl, principal: response.payload.principal },
	});
}

async function requestPasswordReset(invocation: ParsedInvocation, context: CommandContext) {
	const email = value(invocation.args.email) || await promptText(context, 'Email: ');
	if (!email) throw new Error('Email is required.');
	const { profile, client } = createMarketClientForInvocation(invocation, context);
	await client.requestWebPasswordReset({ email });
	return guidedResult({
		command: 'auth password-reset request',
		summary: 'If the account exists, password-reset instructions have been sent.',
		facts: [{ label: 'Market', value: profile.id }],
		nextSteps: [
			profile.id === 'local' ? 'Open local Mailpit at http://127.0.0.1:8025 and copy the reset token or link.' : 'Open the password-reset email sent by TreeSeed.',
			'Run `trsd auth password-reset complete --market ' + profile.id + '` and enter the token and new password silently.',
		],
		report: { marketId: profile.id, baseUrl: profile.baseUrl, requested: true },
	});
}

async function completePasswordReset(invocation: ParsedInvocation, context: CommandContext) {
	requireSecretInput(context);
	const token = value(await promptHidden('Password-reset token: '));
	if (!token) throw new Error('Password-reset token is required.');
	const password = await passwordWithConfirmation(context, 'New password');
	const { profile, client } = createMarketClientForInvocation(invocation, context);
	await client.completeWebPasswordReset({ token, password });
	return guidedResult({
		command: 'auth password-reset complete',
		summary: 'Password reset completed. Sign in with the new password.',
		facts: [{ label: 'Market', value: profile.id }],
		nextSteps: ['Run `trsd auth login --market ' + profile.id + '`.'],
		report: { marketId: profile.id, baseUrl: profile.baseUrl, reset: true },
	});
}

export const handleAuth: CommandHandler = async (invocation, context) => {
	const [action, nested] = invocation.positionals;
	if (action === 'register') return register(invocation, context);
	if (action === 'confirm-email') return confirmEmail(invocation, context);
	if (action === 'login') return invocation.args.device === true ? handleAuthLogin(invocation, context) : passwordLogin(invocation, context);
	if (action === 'password-reset' && nested === 'request') return requestPasswordReset(invocation, context);
	if (action === 'password-reset' && nested === 'complete') return completePasswordReset(invocation, context);
	if (action === 'whoami') return handleAuthWhoAmI(invocation, context);
	if (action === 'logout') return handleAuthLogout(invocation, context);
	throw new Error('Unknown auth command. Use register, confirm-email, login, password-reset request, password-reset complete, whoami, or logout.');
};
