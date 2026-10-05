import { randomUUID } from 'node:crypto';
import { controlPlaneOperation } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';
import { promptHidden } from '../support/prompts.js';

const DEFAULT_REGISTRATION_TIMEOUT_SECONDS = 30;

function requiredOption(invocation: ParsedInvocation, name: string) {
	const value = invocation.options[name];
	if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(`--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required.`), { category: 'invalid_input', code: `${name}_required` });
	return value.trim();
}

async function secret(context: CommandContext, question: string) {
	if (context.promptSecret) return String(await context.promptSecret(question));
	if (!context.interactiveUi) throw Object.assign(new Error('User creation requires an interactive secret prompt.'), { category: 'invalid_input', code: 'interactive_secret_required' });
	return promptHidden(question);
}

function timeoutSeconds(invocation: ParsedInvocation, context: CommandContext) {
	const configured = invocation.options.timeout ?? context.env.TREESEED_CLI_USER_CREATE_TIMEOUT_SECONDS
		?? context.env.TREESEED_CLI_OPERATION_TIMEOUT_SECONDS ?? DEFAULT_REGISTRATION_TIMEOUT_SECONDS;
	const value = Number(configured);
	if (!Number.isFinite(value) || value <= 0 || value > 600) throw Object.assign(new Error('--timeout must be between 1 and 600 seconds.'), { category: 'invalid_input', code: 'invalid_timeout' });
	return value;
}

async function registrationWithin<T>(seconds: number, operation: (signal: AbortSignal) => Promise<T>) {
	const controller = new AbortController();
	let timedOut = false;
	let timer: NodeJS.Timeout;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
			reject(new Error('registration_timeout'));
		}, seconds * 1_000);
	});
	try {
		return await Promise.race([operation(controller.signal), timeout]);
	} catch (error) {
		if (timedOut) throw Object.assign(new Error(`User creation timed out after ${seconds} seconds.`), { category: 'provider_unavailable', code: 'user_creation_timeout' });
		throw error;
	} finally {
		clearTimeout(timer!);
	}
}

export async function runUsers(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name !== 'users create') throw Object.assign(new Error(`No user handler is installed for ${invocation.command.name}.`), { category: 'policy_blocked', code: 'local_handler_unavailable' });
	const email = requiredOption(invocation, 'email');
	const username = requiredOption(invocation, 'username');
	const displayName = requiredOption(invocation, 'displayName');
	const timeout = timeoutSeconds(invocation, context);
	if (invocation.options.plan === true) return { operationId: 'accounts.register', input: { email, username, displayName, passwordSource: 'interactive-secret-prompt' }, mutation: false };
	let password = await secret(context, 'New TreeSeed password: ');
	let confirmation = await secret(context, 'Repeat password: ');
	try {
		if (password !== confirmation) throw Object.assign(new Error('Passwords do not match.'), { category: 'invalid_input', code: 'password_mismatch' });
		if (password.length < 12) throw Object.assign(new Error('Password must be at least 12 characters.'), { category: 'invalid_input', code: 'invalid_password' });
		const input = { path: {}, query: {}, body: { email, username, displayName, password } };
		const response = await registrationWithin(timeout, (signal) => context.operationInvoke
			? context.operationInvoke('accounts.register', input)
			: invokeRegistration(invocation, context, input, signal));
		const envelope = response && typeof response === 'object' ? response as Record<string, unknown> : {};
		const result = envelope.data && typeof envelope.data === 'object' ? envelope.data as Record<string, unknown> : envelope;
		return { ...result, nextAction: 'Open https://mail.treeseed.localhost and confirm the new account, then run trsd auth login.' };
	} finally {
		password = '';
		confirmation = '';
	}
}

async function invokeRegistration(invocation: ParsedInvocation, context: CommandContext, input: { path: {}; query: {}; body: { email: string; username: string; displayName: string; password: string } }, signal: AbortSignal) {
	const operation = controlPlaneOperation('accounts.register');
	const { client } = await createControlPlaneClient(invocation, context, false);
	return client.invoke(operation, input, { idempotencyKey: randomUUID(), headers: {}, signal });
}
