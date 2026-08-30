import type { CommandContext, ParsedInvocation } from '../types.js';
import { invokeHostManager, invokeLocalHostManager } from '../support/host-client.js';
import { storeHostEnrollment, type HostEnrollment } from '../support/host-custody.js';
import { defaultLocalControlPlaneServer, resolveControlPlaneServer } from '@treeseed/sdk/control-plane-client';
import { loadServerRegistry, loadServerSession } from '../support/server-custody.js';
import { promptHidden } from '../support/prompts.js';

const cloudflareSetupGuide = `Cloudflare R2 setup

Create a bootstrap API token at https://dash.cloudflare.com/profile/api-tokens with:
  - Account API Tokens: Write
  - Workers R2 Storage: Write
  - Account resources: the Cloudflare account that will own this team's library

TreeSeed will create a private team bucket, create narrower runtime tokens, store all
credentials in manager custody, and reconcile the host. The bootstrap token is hidden
while entered and is never passed on the command line.
`;
const hostSecuritySetupGuide = `Kata provider security initialization

This operation drains provider writers, creates and verifies the LUKS2 provider volume,
creates an offline recovery bundle, installs the private Kata network and TLS relay,
pulls the pinned guest image, and starts the root broker. It can take several minutes.

You will enter a recovery passphrase. For model authentication, TreeSeed automatically
uses an existing CODEX_HOME/auth.json or ~/.codex/auth.json ChatGPT subscription login
when present. Otherwise it asks for an OpenAI service API key.

Authentication is encrypted into host custody, injected only into each Kata assignment,
and Codex runs with its workspace sandbox enabled. The host login is never printed.

You will enter:
  - A new recovery-bundle passphrase (keep it offline; TreeSeed cannot recover it).
  - An OpenAI service API key only when no existing Codex subscription login is found.

Progress is recorded in the host security receipt. Do not interrupt disk formatting or
state migration after confirming the operation.
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
	if (invocation.command.name.startsWith('host storage ')) {
		const team = activeTeam(invocation, context);
		if (!team) throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before configuring host storage.'), { category: 'ambiguous_context', code: 'active_team_required' });
		const backend = invocation.arguments[0];
		if ((invocation.command.name === 'host storage connect' || invocation.command.name === 'host storage rotate') && backend !== 'cloudflare-r2') {
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
		return { handlerId: invocation.command.execution.handlerId, arguments: [], options: { ...options,
			payload: JSON.stringify({ action, backend: 'cloudflare-r2', teamId: team.id, teamSlug: team.slug,
				accountId: typeof invocation.options.accountId === 'string' ? invocation.options.accountId : undefined, bootstrapToken }) } };
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
		let modelProviderKey: string | undefined;
		let codexAuthFile: string | undefined;
		if (invocation.command.name.endsWith('initialize')) {
			const confirmation = (await ask('Repeat recovery bundle passphrase: ')).trim();
			if (confirmation !== recoveryPassphrase) throw new Error('Recovery bundle passphrases do not match.');
			const codexRoot = context.env.CODEX_HOME || (context.env.HOME ? resolve(context.env.HOME, '.codex') : '');
			const candidate = codexRoot ? resolve(codexRoot, 'auth.json') : '';
			if (candidate && existsSync(candidate)) {
				codexAuthFile = candidate;
				if (context.outputFormat === 'human') context.write('Using the existing Codex ChatGPT subscription login for assignment authentication.\n', 'stderr');
			} else {
				modelProviderKey = (await ask('OpenAI model gateway service API key: ')).trim();
				if (modelProviderKey.length < 20) throw new Error('An OpenAI service API key is required when no Codex subscription login exists.');
			}
		}
		return { handlerId: invocation.command.execution.handlerId, arguments: invocation.arguments, options: { ...options, payload: JSON.stringify({ bundle, recoveryPassphrase,
			...(codexAuthFile ? { codexAuthFile } : modelProviderKey ? { modelProviderKey } : {}) }) } };
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
	return invocation.command.name === 'host config adopt' || invocation.command.name === 'host bootstrap enroll'
		|| invocation.command.name === 'host reset' || invocation.command.name.startsWith('host storage ')
		|| invocation.command.name.startsWith('host security ') || invocation.command.name.startsWith('host sandbox ');
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
	const tracksStorageProgress = context.outputFormat === 'human' && invocation.options.plan !== true
		&& ['host storage connect', 'host storage reconcile', 'host storage rotate'].includes(invocation.command.name);
	if (!tracksStorageProgress) return invoke();
	context.write('Connecting Cloudflare R2. Provisioning storage, securing credentials, and reconciling the host...\n', 'stderr');
	const started = Date.now();
	const progress = setInterval(() => context.write(`Still working on Cloudflare R2 setup (${Math.floor((Date.now() - started) / 1_000)}s elapsed)...\n`, 'stderr'), 10_000);
	try {
		const result = await invoke();
		context.write('Cloudflare R2 storage setup completed.\n', 'stderr');
		return result;
	} finally { clearInterval(progress); }
}
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostConfigurationSchema } from '@treeseed/sdk/deployment';
