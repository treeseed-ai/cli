import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { resolveMarketProfile } from '@treeseed/sdk/market-client';
import { capacityProviderFingerprint, validateCapacityProviderManifestV2, type ProviderSupplyOffer } from '@treeseed/sdk/capacity-provider';
import {
	CapacityProviderCoordinator,
	initializeCapacityProviderIdentity,
	loadCapacityProviderIdentity,
	loadProviderManifest,
	writeProviderManifest,
	providerMarketProfileEnvironmentName,
	providerMarketProfileAudienceEnvironmentName,
	providerSecretPath,
	readProviderConnectionState,
} from '@treeseed/agent/provider-governance';
import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { fail, guidedResult } from './utils.js';
import { redactCapacityOutputSecrets } from './capacity-output-security.js';
import { capacityStringArg as argument } from './capacity-command-arguments.js';

export const CAPACITY_PROVIDER_GOVERNANCE_ACTIONS = new Set([
	'provider-manifest-init',
	'provider-identity-init',
	'provider-identity-show',
	'provider-identity-rotate',
	'provider-connections',
	'provider-connection',
	'provider-join',
	'provider-registration-status',
	'provider-credential-exchange',
	'provider-credential-rotate',
	'provider-leave',
	'provider-offer-validate',
	'provider-offer-plan',
	'provider-offer-apply',
]);

const MUTATING_PROVIDER_GOVERNANCE_ACTIONS = new Set([
	'provider-manifest-init',
	'provider-identity-init',
	'provider-identity-rotate',
	'provider-join',
	'provider-credential-exchange',
	'provider-credential-rotate',
	'provider-leave',
	'provider-offer-apply',
]);

export const DEFAULT_PROVIDER_CAPABILITIES = [
	'engineering',
	'research',
	'planning',
	'acting',
	'verification',
	'agent_mode_run',
	'repo_read',
	'repo_write',
	'repository_work',
] as const;

function manifestPath(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	return resolve(context.cwd, argument(invocation, 'config') ?? 'treeseed.capacity-provider.yaml');
}

function dataDirectory(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	return resolve(context.cwd, argument(invocation, 'dataDir') ?? '.treeseed/local-capacity-provider/data');
}

function connectionId(invocation: TreeseedParsedInvocation) {
	return argument(invocation, 'connection') ?? argument(invocation, 'provider');
}

async function offerDocument(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const inline = argument(invocation, 'document');
	const file = argument(invocation, 'file');
	if (!inline && !file) throw new Error('Provider offer operation requires --file <offer.yaml> or --document \'<yaml-or-json>\'.');
	const parsed = parseYaml(inline ?? await readFile(resolve(context.cwd, file!), 'utf8')) as unknown;
	const offer = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'offer' in parsed
		? (parsed as Record<string, unknown>).offer
		: parsed;
	if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new Error('Provider offer must be a YAML or JSON object.');
	return offer as ProviderSupplyOffer;
}

function providerCoordinatorEnvironment(loaded: Awaited<ReturnType<typeof loadProviderManifest>>, context: TreeseedCommandContext, additionalProfiles: string[] = []) {
	const env = { ...context.env };
	const profiles = [...new Set([...loaded.manifest.connections.map((connection) => connection.marketProfile).filter((value): value is string => Boolean(value)), ...additionalProfiles])];
	for (const profile of profiles) {
		const name = providerMarketProfileEnvironmentName(profile);
		try {
			const baseUrl = resolveMarketProfile(profile).baseUrl;
			env[name] ??= baseUrl;
			env[providerMarketProfileAudienceEnvironmentName(profile)] ??= baseUrl;
		} catch {
			// The provider runtime will report the unresolved profile with its canonical environment key.
		}
	}
	return env;
}

export async function runCapacityProviderGovernanceAction(action: string, invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const plan = invocation.args.plan === true;
	const execute = invocation.args.execute === true;
	if (MUTATING_PROVIDER_GOVERNANCE_ACTIONS.has(action)) {
		if (plan && execute) return fail('Choose exactly one of --plan or --execute.');
		if (!plan && !execute) return fail(`Capacity ${action} is mutating. Pass --plan to inspect it or --execute to apply it.`);
	}
	const configPath = manifestPath(invocation, context);
	if (action === 'provider-manifest-init') {
		const connection = connectionId(invocation) ?? 'primary-team';
		const configuredMarketUrl = argument(invocation, 'providerMarketUrl');
		const configuredMarketProfile = argument(invocation, 'providerMarketProfile') ?? (configuredMarketUrl ? null : 'local');
		const manifest = {
			schemaVersion: 2 as const,
			identity: {
				privateKeyRef: argument(invocation, 'identityKeyRef') ?? 'data://identity.json',
				displayName: argument(invocation, 'displayName') ?? 'Treeseed capacity provider',
			},
			executionProviders: [{
				id: 'codex',
				adapter: 'codex',
				nativeLimits: { maxConcurrentRunners: 1 },
				capabilities: [...DEFAULT_PROVIDER_CAPABILITIES],
			}],
			connections: [],
		};
		if (plan) return guidedResult({
			command: `capacity ${action}`,
			summary: 'Capacity provider manifest initialization plan rendered without mutation.',
			facts: [{ label: 'Manifest', value: configPath }, { label: 'Connection', value: connection }],
			sections: [{ title: 'Manifest', lines: [stringifyYaml(manifest).trimEnd()] }, { title: 'Next', lines: [`Run capacity provider-join --connection ${connection} --registration-key-ref <secret-ref> with the selected market target.`] }],
			report: { action, mode: 'plan', manifest: configPath, payload: manifest },
		});
		if (await access(configPath).then(() => true).catch(() => false)) return fail(`Capacity provider manifest already exists at ${configPath}.`);
		await mkdir(dirname(configPath), { recursive: true });
		await writeFile(configPath, stringifyYaml(manifest), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
		return guidedResult({
			command: `capacity ${action}`,
			summary: 'Capacity provider manifest initialized. Initialize its provider identity before joining a team.',
			facts: [{ label: 'Manifest', value: configPath }, { label: 'Connection', value: connection }],
			report: { action, mode: 'live', manifest: configPath, payload: manifest },
		});
	}
	const loaded = await loadProviderManifest(manifestPath(invocation, context));
	const identityRef = loaded.manifest.identity.privateKeyRef;
	if (action.startsWith('provider-offer-')) {
		const selected = connectionId(invocation);
		if (!selected) return fail(`${action} requires --connection <connection-id>.`);
		const connectionIndex = loaded.manifest.connections.findIndex((connection) => connection.id === selected);
		if (connectionIndex < 0) return fail(`Unknown approved provider connection ${selected}.`);
		const offer = await offerDocument(invocation, context);
		const connections = loaded.manifest.connections.map((connection, index) => index === connectionIndex ? { ...connection, offer } : connection);
		const candidate = { ...loaded.manifest, connections };
		const validation = validateCapacityProviderManifestV2(candidate);
		if (action === 'provider-offer-validate' || action === 'provider-offer-plan') {
			return guidedResult({
				command: `capacity ${action}`,
				summary: validation.ok ? `Provider offer ${action.replace('provider-offer-', '')} passed.` : 'Provider offer is invalid.',
				facts: [{ label: 'Manifest', value: loaded.path }, { label: 'Connection', value: selected }],
				report: {
					action,
					mode: action === 'provider-offer-plan' ? 'plan' : 'validate',
					ok: validation.ok,
					validation,
					...(action === 'provider-offer-plan' ? { current: loaded.manifest.connections[connectionIndex]!.offer, desired: offer } : {}),
				},
				exitCode: validation.ok ? 0 : 1,
			});
		}
		if (!validation.ok) return fail(`Provider offer is invalid: ${validation.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`);
		await writeProviderManifest(loaded, candidate);
		const coordinator = new CapacityProviderCoordinator(loaded, dataDirectory(invocation, context), {
			env: providerCoordinatorEnvironment(loaded, context),
		});
		const payload = await coordinator.reconcileConnection(connections[connectionIndex]!);
		return guidedResult({
			command: `capacity ${action}`,
			summary: `Provider offer applied for connection ${selected}.`,
			facts: [{ label: 'Manifest', value: loaded.path }, { label: 'Connection', value: selected }],
			report: { action, mode: 'live', validation, payload: redactCapacityOutputSecrets(payload) },
		});
	}
	if (plan) return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity provider governance ${action} plan rendered without mutation.`,
		facts: [{ label: 'Manifest', value: loaded.path }, { label: 'Connection', value: connectionId(invocation) ?? 'all' }],
		report: { action, mode: 'plan', manifest: loaded.path, connection: connectionId(invocation) },
	});
	let payload: unknown;
	if (action === 'provider-identity-init' || action === 'provider-identity-show') {
		if (!identityRef.startsWith('file://') && !identityRef.startsWith('data://')) return fail('Provider identity generation requires identity.privateKeyRef to use a file:// or data:// secret reference.');
		const providerDataDirectory = dataDirectory(invocation, context);
		const path = providerSecretPath(identityRef, loaded.directory, providerDataDirectory);
		const exists = await access(path).then(() => true).catch(() => false);
		if (action === 'provider-identity-init' && exists) return fail(`Provider identity already exists at ${path}; use provider-identity-show or the explicit provider-identity-rotate action.`);
		if (action === 'provider-identity-show' && !exists) return fail(`Provider identity does not exist at ${path}; run provider-identity-init.`);
		if (action === 'provider-identity-init') await initializeCapacityProviderIdentity({ ref: identityRef, baseDirectory: loaded.directory, dataDirectory: providerDataDirectory });
		const identity = await loadCapacityProviderIdentity({ ref: identityRef, baseDirectory: loaded.directory, dataDirectory: providerDataDirectory, env: context.env });
		payload = {
			identityRef,
			fingerprint: capacityProviderFingerprint(identity.publicJwk),
			publicJwk: identity.publicJwk,
		};
	} else {
		const selected = connectionId(invocation);
		if (action === 'provider-connections') {
			payload = await Promise.all(loaded.manifest.connections.map(async (connection) => ({
				connection,
				state: await readProviderConnectionState(dataDirectory(invocation, context), connection.id),
			})));
		} else if (action === 'provider-connection') {
			if (!selected) return fail('provider-connection requires --connection <connection-id>.');
			const connection = loaded.manifest.connections.find((entry) => entry.id === selected);
			if (!connection) return fail(`Unknown approved provider connection ${selected}.`);
			payload = {
				connection,
				state: await readProviderConnectionState(dataDirectory(invocation, context), selected),
			};
		} else {
			if (!selected) return fail(`${action} requires --connection <connection-id>.`);
			const manifestConnection = loaded.manifest.connections.find((connection) => connection.id === selected);
			if (action === 'provider-join') {
				const registrationKeyRef = argument(invocation, 'registrationKeyRef');
				if (!registrationKeyRef) return fail('provider-join requires --registration-key-ref <secret-ref>; the reference is used only for this one-time join and is never persisted in the provider manifest.');
				const marketUrl = argument(invocation, 'providerMarketUrl');
				const marketProfile = argument(invocation, 'providerMarketProfile') ?? (marketUrl ? null : 'local');
				const coordinator = new CapacityProviderCoordinator(loaded, dataDirectory(invocation, context), { env: providerCoordinatorEnvironment(loaded, context, marketProfile ? [marketProfile] : []) });
				payload = await coordinator.beginJoin({
					id: selected,
					...(marketUrl ? { marketUrl } : {}),
					...(marketProfile ? { marketProfile } : {}),
					registrationKeyRef,
					offer: { weight: 1, maxConcurrentRunners: 1, capabilities: [...DEFAULT_PROVIDER_CAPABILITIES] },
				});
			} else if (action === 'provider-registration-status' || action === 'provider-credential-exchange') {
				const state = await readProviderConnectionState(dataDirectory(invocation, context), selected);
				const pendingProfiles = state?.marketProfile ? [state.marketProfile] : [];
				const coordinator = new CapacityProviderCoordinator(loaded, dataDirectory(invocation, context), {
					env: providerCoordinatorEnvironment(loaded, context, pendingProfiles),
				});
				payload = action === 'provider-registration-status'
					? await coordinator.pollRegistrationStatus(selected)
					: await coordinator.exchangeRegistrationCredential(selected);
			} else {
				if (!manifestConnection) return fail(`Unknown approved provider connection ${selected}.`);
				const coordinator = new CapacityProviderCoordinator(loaded, dataDirectory(invocation, context), { env: providerCoordinatorEnvironment(loaded, context) });
				payload = action === 'provider-identity-rotate'
					? await coordinator.rotateIdentity(selected)
					: action === 'provider-credential-rotate'
					? await coordinator.rotateConnectionCredential(selected)
					: action === 'provider-leave'
				? await coordinator.leaveConnection(selected)
				: await coordinator.reconcileConnection(manifestConnection);
			}
		}
	}
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity provider governance operation ${action} completed.`,
		facts: [
			{ label: 'Manifest', value: loaded.path },
			{ label: 'Connection', value: connectionId(invocation) ?? 'all' },
		],
		report: { action, manifest: loaded.path, payload: redactCapacityOutputSecrets(payload) },
	});
}
