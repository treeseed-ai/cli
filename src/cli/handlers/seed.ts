import type { TreeseedCommandHandler } from '../types.js';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { formatSeedDiagnostics, formatSeedPlan, loadAndPlanSeed, type SeedPlan } from '@treeseed/sdk/seeds';
import { persistCapacityProviderConnectionToTreeseedConfig } from '@treeseed/sdk/capacity-provider';
import { MarketClientError } from '@treeseed/sdk/market-client';
import { createMarketClientForInvocation, marketAuthRoot, marketSelector } from './market-utils.js';
import { MarketClient, resolveMarketProfile, resolveMarketSession, setMarketSession, type MarketSession } from '@treeseed/sdk/market-client';

type LocalSeedApplyRunner = (input: {
	projectRoot: string;
	seedName: string;
	environments?: string;
	plan: SeedPlan;
	accessToken?: string;
	env?: NodeJS.ProcessEnv;
}) => Promise<{ plan: SeedPlan; result: Record<string, unknown> }>;
type LocalSeedPlanRunner = (input: {
	projectRoot: string;
	seedName: string;
	environments?: string;
	mode?: SeedPlan['mode'];
	accessToken?: string;
	env?: NodeJS.ProcessEnv;
}) => Promise<{ plan: SeedPlan | null; diagnostics: unknown[]; manifestPath: string }>;
type LocalSeedExportRunner = (input: {
	projectRoot: string;
	seedName: string;
	team: string;
	environments?: string;
	includePrivate?: boolean;
	includeArtifacts?: boolean;
	accessToken?: string;
	env?: NodeJS.ProcessEnv;
}) => Promise<Record<string, unknown>>;

async function loadLocalSeedModule(projectRoot: string): Promise<{
	applyLocalSeedFromCli?: LocalSeedApplyRunner;
	applyLocalSeedViaApiFromCli?: LocalSeedApplyRunner;
	planLocalSeedFromCli?: LocalSeedPlanRunner;
	planLocalSeedViaApiFromCli?: LocalSeedPlanRunner;
	exportSeedFromCli?: LocalSeedExportRunner;
	exportLocalSeedViaApiFromCli?: LocalSeedExportRunner;
}> {
	const rootApiModulePath = resolve(projectRoot, 'src', 'lib', 'market', 'seeds', 'local-api.js');
	const rootApplyModulePath = resolve(projectRoot, 'src', 'lib', 'market', 'seeds', 'apply.js');
	const packageApiModulePath = resolve(projectRoot, 'packages', 'api', 'src', 'market', 'seeds', 'local-api.js');
	const packageApplyModulePath = resolve(projectRoot, 'packages', 'api', 'src', 'market', 'seeds', 'apply.js');
	const apiModulePath = existsSync(rootApiModulePath) ? rootApiModulePath : packageApiModulePath;
	const applyModulePath = existsSync(rootApplyModulePath) ? rootApplyModulePath : packageApplyModulePath;
	const applyModule = await import(pathToFileURL(applyModulePath).href) as {
		applyLocalSeedFromCli?: LocalSeedApplyRunner;
		planLocalSeedFromCli?: LocalSeedPlanRunner;
		exportSeedFromCli?: LocalSeedExportRunner;
	};
	if (!existsSync(apiModulePath)) {
		return applyModule;
	}
	const apiModule = await import(pathToFileURL(apiModulePath).href) as {
		applyLocalSeedViaApiFromCli?: LocalSeedApplyRunner;
		planLocalSeedViaApiFromCli?: LocalSeedPlanRunner;
		exportLocalSeedViaApiFromCli?: LocalSeedExportRunner;
	};
	return {
		...applyModule,
		...apiModule,
	};
}

function sessionExpiresSoon(session: MarketSession) {
	if (!session.expiresAt) return false;
	const expiresAt = Date.parse(session.expiresAt);
	return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60_000;
}

async function requireLocalSeedSession(invocation: Parameters<TreeseedCommandHandler>[0], context: Parameters<TreeseedCommandHandler>[1]) {
	const selector = marketSelector(invocation) ?? 'local';
	const profile = resolveMarketProfile(selector);
	const tenantRoot = marketAuthRoot(context);
	const session = resolveMarketSession(tenantRoot, profile.id);
	if (!session?.accessToken) {
		if (profile.id === 'local') {
			return {
				profile,
				session: {
					marketId: profile.id,
					accessToken: '',
					refreshToken: null,
					expiresAt: null,
					principal: null,
				},
			};
		}
		throw new Error(`Not logged in to market "${profile.id}". Run treeseed auth:login --market ${profile.id}.`);
	}
	if (sessionExpiresSoon(session) && session.refreshToken) {
		try {
			const refreshed = await new MarketClient({ profile, userAgent: 'treeseed-cli' }).refreshToken({ refreshToken: session.refreshToken });
			if (refreshed.ok) {
				const nextSession = {
					marketId: profile.id,
					accessToken: refreshed.accessToken,
					refreshToken: refreshed.refreshToken,
					expiresAt: refreshed.expiresAt,
					principal: refreshed.principal,
				};
				setMarketSession(tenantRoot, nextSession);
				return { profile, session: nextSession };
			}
		} catch {
			if (profile.id === 'local') {
				return {
					profile,
					session: {
						marketId: profile.id,
						accessToken: '',
						refreshToken: null,
						expiresAt: null,
						principal: null,
					},
				};
			}
			throw new Error(`Login for market "${profile.id}" expired. Run treeseed auth:login --market ${profile.id}.`);
		}
	}
	if (sessionExpiresSoon(session)) {
		if (profile.id === 'local') {
			return {
				profile,
				session: {
					marketId: profile.id,
					accessToken: '',
					refreshToken: null,
					expiresAt: null,
					principal: null,
				},
			};
		}
		throw new Error(`Login for market "${profile.id}" expired. Run treeseed auth:login --market ${profile.id}.`);
	}
	return { profile, session };
}

function seedRequestBody(invocation: Parameters<TreeseedCommandHandler>[0]) {
	return {
		...(typeof invocation.args.environments === 'string' ? { environments: invocation.args.environments.split(',').map((entry) => entry.trim()).filter(Boolean) } : {}),
		...(typeof invocation.args.approvalRequest === 'string' ? { approvalRequestId: invocation.args.approvalRequest } : {}),
	};
}

function planFromRemotePayload(payload: Record<string, unknown>): SeedPlan {
	return {
		ok: payload.ok !== false,
		seed: String(payload.seed ?? ''),
		version: 1,
		mode: payload.mode === 'apply' ? 'apply' : 'plan',
		environments: Array.isArray(payload.environments) ? payload.environments as SeedPlan['environments'] : [],
		summary: payload.summary as SeedPlan['summary'],
		actions: Array.isArray(payload.actions) ? payload.actions as SeedPlan['actions'] : [],
		recipes: Array.isArray(payload.recipes) ? payload.recipes as SeedPlan['recipes'] : [],
		diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics as SeedPlan['diagnostics'] : [],
		manifestPath: '',
	};
}

function remoteSeedResult(payload: Record<string, unknown>, command: string, exitCode = 0) {
	const plan = planFromRemotePayload(payload);
	const result = payload.result && typeof payload.result === 'object' ? payload.result as Record<string, unknown> : null;
	return {
		exitCode,
		stdout: exitCode === 0
			? [
				...formatSeedPlan(plan),
				...(result
					? [
						'',
						'Apply:',
						`  created: ${plan.summary.create}`,
						`  updated: ${plan.summary.update}`,
						`  unchanged: ${plan.summary.unchanged}`,
						`  skipped: ${plan.summary.skip}`,
						`  failed: ${plan.summary.error}`,
						...formatCapacityProviderKeyNotes(result),
					]
					: []),
			]
			: [],
		stderr: exitCode === 0 ? [] : [typeof payload.error === 'string' ? payload.error : 'Seed operation failed.'],
		report: {
			...payload,
			command,
			ok: exitCode === 0,
		},
	};
}

function formatCapacityProviderKeyNotes(result: Record<string, unknown>) {
	const capacityProviderKeys = result.capacityProviderKeys && typeof result.capacityProviderKeys === 'object'
		? result.capacityProviderKeys as Record<string, unknown>
		: null;
	const created = Array.isArray(capacityProviderKeys?.created) ? capacityProviderKeys.created as Record<string, unknown>[] : [];
	if (created.length === 0) return [];
	return [
		'',
		'Provider connection:',
		...created.map((entry) =>
			`  ${String(entry.providerName ?? entry.providerKey ?? entry.providerId)} (${String(entry.keyPrefix ?? 'new key')}): stored in encrypted Treeseed config`),
		'  Use `treeseed capacity up --market local --provider local` to launch the provider.',
	];
}

function redactLocalCapacityProviderKeys(result: Record<string, unknown>) {
	const capacityProviderKeys = result.capacityProviderKeys && typeof result.capacityProviderKeys === 'object'
		? result.capacityProviderKeys as Record<string, unknown>
		: null;
	if (!capacityProviderKeys) return result;
	return {
		...result,
		capacityProviderKeys: {
			...capacityProviderKeys,
			created: Array.isArray(capacityProviderKeys.created)
				? capacityProviderKeys.created.map((entry) => {
					if (!entry || typeof entry !== 'object') return entry;
					const { plaintextKey: _plaintextKey, ...safeEntry } = entry as Record<string, unknown>;
					return {
						...safeEntry,
						storedInTreeseedConfig: true,
					};
				})
				: [],
		},
	};
}

function storeLocalCapacityProviderConnection(input: {
	context: Parameters<TreeseedCommandHandler>[1];
	profile: ReturnType<typeof resolveMarketProfile>;
	result: Record<string, unknown>;
}) {
	const capacityProviderKeys = input.result.capacityProviderKeys && typeof input.result.capacityProviderKeys === 'object'
		? input.result.capacityProviderKeys as Record<string, unknown>
		: null;
	const created = Array.isArray(capacityProviderKeys?.created) ? capacityProviderKeys.created as Record<string, unknown>[] : [];
	const first = created.find((entry) => typeof entry.plaintextKey === 'string' && String(entry.plaintextKey).length > 0);
	if (!first) return null;
	return persistCapacityProviderConnectionToTreeseedConfig({
		tenantRoot: input.context.cwd,
		scope: 'local',
		marketUrl: input.profile.baseUrl,
		marketId: input.profile.id,
		apiKey: String(first.plaintextKey),
		providerHostDataDir: '.treeseed/local-capacity-provider/data',
		providerEnvironment: 'local',
	});
}

function remoteSeedError(error: unknown, command: string) {
	if (error instanceof MarketClientError) {
		const payload = error.payload && typeof error.payload === 'object' ? error.payload as Record<string, unknown> : { error: error.message };
		const blocked = error.status === 409 || (payload.result as Record<string, unknown> | undefined)?.blocked === true;
		const auth = error.status === 401 || error.status === 403;
		return remoteSeedResult(payload, command, blocked ? 2 : auth ? 4 : 3);
	}
	if (error instanceof Error && /not logged in|authentication|permission denied/iu.test(error.message)) {
		return {
			exitCode: 4,
			stderr: [error.message],
			report: {
				command,
				ok: false,
				error: error.message,
			},
		};
	}
	throw error;
}

function writeSeedExportOutput(context: Parameters<TreeseedCommandHandler>[1], outputPath: string, yaml: string) {
	const destination = resolve(context.cwd, outputPath);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, yaml, 'utf8');
	return destination;
}

async function handleSeedExport(invocation: Parameters<TreeseedCommandHandler>[0], context: Parameters<TreeseedCommandHandler>[1]) {
	const seedName = invocation.positionals[1];
	const team = typeof invocation.args.team === 'string' ? invocation.args.team.trim() : '';
	if (!seedName || !team) {
		return {
			exitCode: 1,
			stderr: ['Usage: treeseed seed export <name> --team <team> [--output seeds/exported.yaml]'],
			report: {
				command: 'seed export',
				ok: false,
				error: !seedName ? 'Missing required export seed name.' : 'Missing required --team.',
			},
		};
	}
	const body = {
		name: seedName,
		...(typeof invocation.args.environments === 'string' ? { environments: invocation.args.environments.split(',').map((entry) => entry.trim()).filter(Boolean) } : {}),
		...(invocation.args.includePrivate === true ? { includePrivate: true } : {}),
		...(invocation.args.includeArtifacts === true ? { includeArtifacts: true } : {}),
	};
	let payload: Record<string, unknown>;
	try {
		if (typeof invocation.args.market === 'string' || typeof invocation.args.host === 'string') {
			const { client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
			payload = await client.exportSeed(team, body);
		} else {
			const { session } = await requireLocalSeedSession(invocation, context);
			const localModule = await loadLocalSeedModule(context.cwd);
			const exporter = localModule.exportLocalSeedViaApiFromCli ?? localModule.exportSeedFromCli;
			if (typeof exporter !== 'function') {
				throw new Error('Local seed export service is not available in this market project.');
			}
			payload = await exporter({
				projectRoot: context.cwd,
				seedName,
				team,
				environments: typeof invocation.args.environments === 'string' ? invocation.args.environments : undefined,
				includePrivate: invocation.args.includePrivate === true,
				includeArtifacts: invocation.args.includeArtifacts === true,
				accessToken: session.accessToken,
				env: context.env,
			});
		}
	} catch (error) {
		return remoteSeedError(error, 'seed export');
	}
	const yaml = typeof payload.yaml === 'string' ? payload.yaml : '';
	const outputPath = typeof invocation.args.output === 'string' && invocation.args.output.trim() ? invocation.args.output.trim() : null;
	const writtenPath = outputPath ? writeSeedExportOutput(context, outputPath, yaml) : null;
	const ok = payload.ok !== false;
	return {
		exitCode: ok ? 0 : 1,
		stdout: context.outputFormat === 'json'
			? []
			: writtenPath
				? [`Exported seed ${String(payload.seed ?? seedName)} to ${writtenPath}.`]
				: yaml.trimEnd().split('\n'),
		stderr: ok ? [] : ['Seed export failed.'],
		report: {
			...payload,
			command: 'seed export',
			outputPath: writtenPath,
		},
	};
}

export const handleSeed: TreeseedCommandHandler = async (invocation, context) => {
	if (invocation.positionals[0] === 'export') {
		return handleSeedExport(invocation, context);
	}
	const seedName = invocation.positionals[0];
	if (!seedName) {
		return {
			exitCode: 1,
			stderr: ['Usage: treeseed seed <name> [--environments local,staging,prod] [--plan|--validate]'],
			report: {
				command: 'seed',
				ok: false,
				error: 'Missing required seed name.',
			},
		};
	}

	const wantsApply = invocation.args.apply === true;
	const wantsValidate = invocation.args.validate === true;
	const mode = wantsApply ? 'apply' : wantsValidate ? 'validate' : 'plan';
	const planned = loadAndPlanSeed({
		projectRoot: context.cwd,
		seedName,
		environments: typeof invocation.args.environments === 'string' ? invocation.args.environments : undefined,
		mode,
	});

	if (!planned.plan) {
		return {
			exitCode: 1,
			stderr: formatSeedDiagnostics(planned.diagnostics),
			report: {
				command: 'seed',
				ok: false,
				seed: seedName,
				mode,
				manifestPath: planned.manifestPath,
				diagnostics: planned.diagnostics,
			},
		};
	}

	if (!wantsApply && !wantsValidate && planned.plan.environments.length === 1 && planned.plan.environments[0] === 'local') {
		try {
			const localModule = await loadLocalSeedModule(context.cwd);
			const localPlanner = localModule.planLocalSeedFromCli ?? localModule.planLocalSeedViaApiFromCli;
			if (typeof localPlanner === 'function') {
				const localPlanned = await localPlanner({
					projectRoot: context.cwd,
					seedName,
					environments: typeof invocation.args.environments === 'string' ? invocation.args.environments : undefined,
					mode,
					env: context.env,
				});
				if (localPlanned.plan) {
					planned.plan = localPlanned.plan;
				}
			}
		} catch (error) {
			if (error instanceof Error && /not logged in|authentication|permission denied/iu.test(error.message)) {
				return remoteSeedError(error, 'seed');
			}
			planned.plan.diagnostics.push({
				severity: 'warning',
				code: 'seed.local_state_unavailable',
				message: 'Local current state could not be loaded; falling back to manifest-only planning.',
				path: 'local',
			});
		}
	}

	if (wantsApply) {
		if (planned.plan.environments.some((environment) => environment !== 'local')) {
			try {
				const { client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
				const payload = await client.applySeed(seedName, seedRequestBody(invocation));
				return remoteSeedResult(payload, 'seed');
			} catch (error) {
				return remoteSeedError(error, 'seed');
			}
		}
		let localAuth: Awaited<ReturnType<typeof requireLocalSeedSession>>;
		try {
			localAuth = await requireLocalSeedSession(invocation, context);
		} catch (error) {
			return remoteSeedError(error, 'seed');
		}
		const localModule = await loadLocalSeedModule(context.cwd);
		const runner = localAuth.session.accessToken
			? localModule.applyLocalSeedViaApiFromCli ?? localModule.applyLocalSeedFromCli
			: localModule.applyLocalSeedFromCli ?? localModule.applyLocalSeedViaApiFromCli;
		if (typeof runner !== 'function') {
			throw new Error('Local seed apply service is not available in this market project.');
		}
		const applied = await runner({
			projectRoot: context.cwd,
			seedName,
			environments: typeof invocation.args.environments === 'string' ? invocation.args.environments : undefined,
			plan: planned.plan,
			accessToken: localAuth?.session.accessToken,
			env: context.env,
		});
		let providerConnection: ReturnType<typeof storeLocalCapacityProviderConnection> = null;
		try {
			providerConnection = storeLocalCapacityProviderConnection({
				context,
				profile: localAuth.profile,
				result: applied.result,
			});
		} catch (error) {
			const message = `Unable to store local capacity provider connection in encrypted Treeseed config. ${error instanceof Error ? error.message : String(error)}`;
			return {
				exitCode: 4,
				stderr: [message],
				report: {
					command: 'seed',
					ok: false,
					error: message,
				},
			};
		}
		const safeResult = redactLocalCapacityProviderKeys(applied.result);
		const message = 'Local seed apply completed.';
		return {
			exitCode: 0,
			stdout: context.outputFormat === 'json'
				? []
				: [
					...formatSeedPlan(applied.plan),
					'',
					'Apply:',
					`  created: ${applied.plan.summary.create}`,
					`  updated: ${applied.plan.summary.update}`,
					`  unchanged: ${applied.plan.summary.unchanged}`,
					`  skipped: ${applied.plan.summary.skip}`,
					`  failed: ${applied.plan.summary.error}`,
					...formatCapacityProviderKeyNotes(safeResult),
				],
			report: {
				...applied.plan,
				ok: true,
				command: 'seed',
				result: {
					message,
					...safeResult,
					...(providerConnection ? {
						capacityProviderConnection: {
							scope: providerConnection.scope,
							writtenKeys: providerConnection.writtenKeys,
							redactedEnv: providerConnection.redactedEnv,
						},
					} : {}),
				},
			},
		};
	}

	if (wantsValidate) {
		return {
			exitCode: 0,
			stdout: [`Seed ${planned.plan.seed} is valid for environments: ${planned.plan.environments.join(', ')}.`],
			report: {
				...planned.plan,
				command: 'seed',
			},
		};
	}

	if (planned.plan.environments.some((environment) => environment !== 'local')) {
		try {
			const { client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
			const payload = await client.planSeed(seedName, seedRequestBody(invocation));
			return remoteSeedResult(payload, 'seed');
		} catch (error) {
			return remoteSeedError(error, 'seed');
		}
	}

	return {
		exitCode: 0,
		stdout: formatSeedPlan(planned.plan),
		report: {
			...planned.plan,
			command: 'seed',
		},
	};
};
