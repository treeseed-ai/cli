import type { CommandContext, ParsedInvocation } from '../types.js';
import { invokeHostManager, invokeLocalHostManager } from '../support/host-client.js';
import { storeHostEnrollment, type HostEnrollment } from '../support/host-custody.js';
import { defaultLocalControlPlaneServer, resolveControlPlaneServer } from '@treeseed/sdk/control-plane-client';
import { loadServerRegistry, loadServerSession } from '../support/server-custody.js';
import { promptHidden, promptText } from '../support/prompts.js';

const cloudflareSetupGuide = `Cloudflare R2 setup

Create a bootstrap API token at https://dash.cloudflare.com/profile/api-tokens with:
  - Account API Tokens: Write
  - Workers R2 Storage: Write
  - Account resources: the Cloudflare account that will own this team's library

TreeSeed will create the private control-plane environment bucket, create narrower runtime tokens, store all
credentials in manager custody, and reconcile the host. The bootstrap token is hidden
while entered and is never passed on the command line.
`;
const hostSecuritySetupGuide = `Kata provider security initialization

This operation drains provider writers, creates and verifies the LUKS2 provider volume,
creates an offline recovery bundle, installs the private Kata network and TLS relay,
pulls the pinned guest image, and starts the root broker. It can take several minutes.

You will enter:
  - A new recovery-bundle passphrase (keep it offline; TreeSeed cannot recover it).

Progress is recorded in the host security receipt. Do not interrupt disk formatting or
state migration after confirming the operation. Execution-provider credentials are
initialized separately through registered provider credential initializers.
`;

function activeTeam(invocation: ParsedInvocation, context: CommandContext) {
	const local = defaultLocalControlPlaneServer(context.env as Record<string, string | undefined>);
	const stored = loadServerRegistry(context.env);
	const registry = { version: 1 as const, activeServerId: stored.activeServerId || local.serverId, servers: [...stored.servers.filter((entry) => entry.serverId !== local.serverId), local] };
	const selector = typeof invocation.options.server === 'string' ? invocation.options.server : undefined;
	return loadServerSession(resolveControlPlaneServer(selector, registry).serverId, context.env)?.activeTeam ?? null;
}

async function input(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.execution.kind !== 'local') throw new Error('Host command is not locally bound.');
	const { server: _server, json: _json, yes: _yes, ...options } = invocation.options;
	if (invocation.command.name === 'host initialize') {
		const profile = invocation.options.profile;
		if (typeof profile !== 'string' || !/^[a-z][a-z0-9.-]{1,63}$/u.test(profile)) throw new Error('Host initialize requires a valid --profile identity.');
		if (invocation.options.plan === true) return { handlerId: invocation.command.execution.handlerId, arguments: [], options: { plan: true, profile } };
		if (invocation.options.confirm !== true || invocation.options.yes !== true) {
			throw Object.assign(new Error('Host initialize execution requires both --confirm and --yes after reviewing the plan.'), { category: 'confirmation_required', code: 'confirmation_required' });
		}
		const planCommand = { handlerId: invocation.command.execution.handlerId, arguments: [], options: { plan: true, profile } };
		const planned = await (context.hostInvoke ? context.hostInvoke(planCommand) : invokeLocalHostManager(planCommand)) as { inputs?: Array<{ name: string; required: boolean; sensitive: boolean; description: string }> };
		const values: Record<string, string> = {};
		for (const descriptor of planned.inputs ?? []) {
			if (!/^[a-z][A-Za-z0-9]{1,63}$/u.test(descriptor.name)) throw new Error('Host initialization plan contains an invalid input descriptor.');
			const question = `${descriptor.description}: `;
			const value = descriptor.sensitive
				? String(context.promptSecret ? await context.promptSecret(question) : await promptHidden(question)).trim()
				: await promptText(context, question);
			if (!value && descriptor.required) throw new Error(`Required host initialization input ${descriptor.name} was not provided.`);
			if (descriptor.name === 'controlPlaneUrl' && value) {
				let url: URL;
				try { url = new URL(value); } catch { throw new Error('Control-plane URL must be a valid HTTPS URL.'); }
				if (url.protocol !== 'https:') throw new Error('Control-plane URL must use HTTPS.');
			}
			if (value) values[descriptor.name] = value;
		}
		return { handlerId: invocation.command.execution.handlerId, arguments: [], options: { profile, confirm: true, payload: JSON.stringify({ profile, inputs: values }) } };
	}
	if (invocation.command.name === 'host uninstall' && invocation.options.plan !== true) {
		if (invocation.options.confirm !== true || invocation.options.yes !== true) {
			throw Object.assign(new Error('Host uninstall execution requires both --confirm and --yes after reviewing the plan.'), {
				category: 'confirmation_required', code: 'confirmation_required',
			});
		}
	}
	if (invocation.command.name === 'host provider credentials initialize') {
		const initializerId = invocation.arguments[0];
		if (!initializerId) throw new Error('A registered provider credential initializer is required. Run `trsd host provider credentials list`.');
		const listCommand = { handlerId: 'local.host.provider.credentials.list', arguments: [], options: {} };
		const listed = await (context.hostInvoke ? context.hostInvoke(listCommand) : invokeLocalHostManager(listCommand)) as { initializers?: Array<{ id: string; displayName: string; description: string; sources: Array<{ id: string; label: string; kind: 'file' | 'secret'; prompt: string; suggestedPaths: string[] }> }> };
		const initializer = listed.initializers?.find((candidate) => candidate.id === initializerId);
		if (!initializer) throw new Error(`Provider credential initializer ${initializerId} is not registered.`);
		const requestedSource = typeof invocation.options.source === 'string' ? invocation.options.source : undefined;
		const expand = (path: string) => path.replace(/\$([A-Z][A-Z0-9_]*)/gu, (_match, name: string) => context.env[name] ?? '');
		const discovered = initializer.sources.flatMap((source) => source.kind === 'file' ? source.suggestedPaths.map(expand).filter((path) => path && existsSync(path)).map((path) => ({ source, path })) : []).at(0);
		const source = requestedSource ? initializer.sources.find((candidate) => candidate.id === requestedSource) : discovered?.source ?? initializer.sources.find((candidate) => candidate.kind === 'secret') ?? initializer.sources[0];
		if (!source) throw new Error(`Provider credential initializer ${initializerId} has no usable sources.`);
		if (context.outputFormat === 'human') context.write(`${initializer.displayName}\n${initializer.description}\nUsing credential source: ${source.label}\n`, 'stderr');
		let secret: string;
		if (source.kind === 'file') {
			const suggested = discovered?.source.id === source.id ? discovered.path : undefined;
			const path = suggested ?? String(context.prompt ? await context.prompt(`${source.prompt}: `) : '').trim();
			if (!path || !existsSync(path)) throw new Error(`Credential file for ${source.label} does not exist.`);
			secret = readFileSync(resolve(path), 'utf8');
		} else secret = (context.promptSecret ? String(await context.promptSecret(`${source.prompt}: `)) : await promptHidden(`${source.prompt}: `)).trim();
		return { handlerId: invocation.command.execution.handlerId, arguments: [initializerId], options: { ...options, payload: JSON.stringify({ sourceId: source.id, secret }) } };
	}
	if (invocation.command.name.startsWith('host storage ')) {
		const team = activeTeam(invocation, context);
		if (!team) throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before configuring host storage.'), { category: 'ambiguous_context', code: 'active_team_required' });
		const backend = invocation.arguments[0];
		if ((invocation.command.name === 'host storage connect' || invocation.command.name === 'host storage rotate'
			|| invocation.command.name === 'host storage reset') && backend !== 'cloudflare-r2') {
			throw new Error('The only supported host storage backend is cloudflare-r2.');
		}
		let bootstrapToken: string | undefined;
		if (invocation.command.name === 'host storage connect' && invocation.options.plan !== true) {
			if (context.outputFormat === 'human') context.write(`${cloudflareSetupGuide}\n`, 'stderr');
			bootstrapToken = context.promptSecret
				? String(await context.promptSecret('Cloudflare deployment bootstrap token: ')).trim()
				: (await promptHidden('Cloudflare deployment bootstrap token: ')).trim();
			if (bootstrapToken.length < 16) throw new Error('Cloudflare deployment bootstrap token is invalid.');
		}
		const action = invocation.command.name.slice('host storage '.length);
		const environment = invocation.command.name === 'host storage reset' ? String(invocation.options.environment ?? '') : undefined;
		if (invocation.command.name === 'host storage reset' && environment !== 'production' && environment !== 'staging') {
			throw new Error('Host storage reset requires --environment production or --environment staging.');
		}
		return { handlerId: invocation.command.execution.handlerId, arguments: [], options: { ...options,
			payload: JSON.stringify({ action, backend: 'cloudflare-r2', teamId: team.id, teamSlug: team.slug,
				environment, accountId: typeof invocation.options.accountId === 'string' ? invocation.options.accountId : undefined, bootstrapToken }) } };
	}
	if (invocation.command.name === 'host security initialize' || invocation.command.name === 'host security recovery verify' || invocation.command.name === 'host security rotate') {
		if (invocation.command.name === 'host security rotate') {
			const recoveryBundle = invocation.options.recoveryBundle, newRecoveryBundle = invocation.options.newRecoveryBundle;
			if (typeof recoveryBundle !== 'string' || !recoveryBundle.startsWith('/') || typeof newRecoveryBundle !== 'string' || !newRecoveryBundle.startsWith('/')) throw new Error('Current and new absolute recovery bundle paths are required.');
			if (invocation.options.confirm !== true) throw new Error('Host security rotation requires --confirm.');
			const ask = async (question: string) => context.promptSecret ? String(await context.promptSecret(question)) : promptHidden(question);
			const recoveryPassphrase = (await ask('Current recovery bundle passphrase: ')).trim(); const newRecoveryPassphrase = (await ask('New recovery bundle passphrase: ')).trim();
			if (recoveryPassphrase.length < 12 || newRecoveryPassphrase.length < 12) throw new Error('Recovery bundle passphrases must contain at least 12 characters.');
			if ((await ask('Repeat new recovery bundle passphrase: ')).trim() !== newRecoveryPassphrase) throw new Error('New recovery bundle passphrases do not match.');
			return { handlerId: invocation.command.execution.handlerId, arguments: invocation.arguments, options: { ...options, payload: JSON.stringify({ recoveryBundle, recoveryPassphrase, newRecoveryBundle, newRecoveryPassphrase }) } };
		}
		if (invocation.command.name === 'host security initialize' && context.outputFormat === 'human') context.write(`${hostSecuritySetupGuide}\n`, 'stderr');
		const bundle = invocation.command.name.endsWith('initialize') ? invocation.options.recoveryBundle : invocation.options.bundle;
		if (typeof bundle !== 'string' || !bundle.startsWith('/')) throw new Error('An absolute recovery bundle path is required.');
		if (invocation.command.name.endsWith('initialize') && invocation.options.confirm !== true) throw new Error('Host security initialization requires --confirm.');
		const ask = async (question: string) => context.promptSecret ? String(await context.promptSecret(question)) : promptHidden(question);
		const recoveryPassphrase = (await ask('Recovery bundle passphrase: ')).trim();
		if (recoveryPassphrase.length < 12) throw new Error('Recovery bundle passphrase must contain at least 12 characters.');
		if (invocation.command.name.endsWith('initialize')) {
			const confirmation = (await ask('Repeat recovery bundle passphrase: ')).trim();
			if (confirmation !== recoveryPassphrase) throw new Error('Recovery bundle passphrases do not match.');
		}
		return { handlerId: invocation.command.execution.handlerId, arguments: invocation.arguments, options: { ...options, payload: JSON.stringify({ bundle, recoveryPassphrase }) } };
	}
	if (invocation.command.name.startsWith('host config ') && invocation.command.name !== 'host config show') {
		const file = invocation.arguments[0];
		if (!file) throw new Error('A host configuration file is required.');
		const configuration = hostConfigurationSchema.parse(JSON.parse(readFileSync(resolve(file), 'utf8')));
		return { handlerId: invocation.command.execution.handlerId, arguments: [], options, configuration };
	}
	return { handlerId: invocation.command.execution.handlerId, arguments: invocation.arguments, options };
}

export function hostUsesProtectedLocalTransport(invocation: Pick<ParsedInvocation, 'command'>) {
	return invocation.command.name === 'host initialize' || invocation.command.name === 'host config adopt' || invocation.command.name === 'host bootstrap enroll'
		|| invocation.command.name === 'host reset' || invocation.command.name === 'host uninstall' || invocation.command.name.startsWith('host storage ')
		|| invocation.command.name.startsWith('host security ') || invocation.command.name.startsWith('host sandbox ')
		|| invocation.command.name.startsWith('host provider credentials ');
}

export async function runHost(invocation: ParsedInvocation, context: CommandContext) {
	const command = await input(invocation, context);
	if (invocation.options.plan === true && invocation.command.name === 'host bootstrap enroll') return { action: 'enroll', mutation: false, transport: 'local_socket' };
	if (invocation.command.name === 'host bootstrap enroll') {
		const enrollment = await (context.hostInvoke ? context.hostInvoke(command) : invokeLocalHostManager(command)) as HostEnrollment;
		const endpoint = typeof invocation.options.server === 'string' && invocation.options.server.includes('://')
			? invocation.options.server
			: context.env.TREESEED_HOST_URL ?? 'https://manager.treeseed.localhost';
		return storeHostEnrollment(enrollment, endpoint, context.env);
	}
	const invoke = () => context.hostInvoke ? context.hostInvoke(command)
		: hostUsesProtectedLocalTransport(invocation) ? invokeLocalHostManager(command)
			: invokeHostManager(command, typeof invocation.options.server === 'string' ? invocation.options.server : undefined, context.env);
	const progressLabel = context.outputFormat === 'human' && invocation.options.plan !== true ? ({
		'host initialize': 'Initializing the selected TreeSeed host profile',
		'host storage connect': 'Connecting Cloudflare R2. Provisioning storage, securing credentials, and reconciling the host',
		'host storage reconcile': 'Reconciling Cloudflare R2 storage',
		'host storage rotate': 'Rotating Cloudflare R2 storage credentials',
		'host storage reset': 'Emptying and recreating the selected Cloudflare R2 bucket',
		'host security initialize': 'Initializing encrypted provider storage and the Kata sandbox broker',
		'host provider credentials initialize': 'Encrypting and activating the registered provider credential',
	} as Record<string, string>)[invocation.command.name] : undefined;
	if (!progressLabel) return invoke();
	context.write(`${progressLabel}...\n`, 'stderr');
	const started = Date.now();
	const progress = setInterval(() => context.write(`Still working (${Math.floor((Date.now() - started) / 1_000)}s elapsed)...\n`, 'stderr'), 10_000);
	try {
		const result = await invoke();
		context.write(invocation.command.name.startsWith('host storage ') ? 'Cloudflare R2 storage setup completed.\n' : 'Completed.\n', 'stderr');
		return result;
	} finally { clearInterval(progress); }
}
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostConfigurationSchema } from '@treeseed/sdk/deployment';
