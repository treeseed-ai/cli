import type { CommandHandler } from '../../types.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { SeedPlan } from '@treeseed/sdk/seeds';
import { MarketClient, resolveMarketProfile, resolveMarketSession, setMarketSession, type MarketSession } from '@treeseed/sdk/market-client';
import { marketAuthRoot, marketSelector } from '../content/market-utils.js';

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

function localAcceptanceAdminToken(env: NodeJS.ProcessEnv) {
	return env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN?.trim() || 'tsk_local_treeseed_acceptance_admin';
}

export async function loadLocalSeedModule(projectRoot: string): Promise<{
	applyLocalSeedFromCli?: LocalSeedApplyRunner;
	applyLocalSeedViaApiFromCli?: LocalSeedApplyRunner;
	planLocalSeedFromCli?: LocalSeedPlanRunner;
	planLocalSeedViaApiFromCli?: LocalSeedPlanRunner;
	exportSeedFromCli?: LocalSeedExportRunner;
	exportLocalSeedViaApiFromCli?: LocalSeedExportRunner;
}> {
	const rootApiModulePath = resolve(projectRoot, 'src', 'lib', 'market', 'seeds', 'local-api.js');
	const rootApplyModulePath = resolve(projectRoot, 'src', 'lib', 'market', 'seeds', 'apply.js');
	const packageApiDistModulePath = resolve(projectRoot, 'packages', 'api', 'dist', 'market', 'seeds', 'local-api.js');
	const packageApplyDistModulePath = resolve(projectRoot, 'packages', 'api', 'dist', 'market', 'seeds', 'apply.js');
	const packageApiSourceModulePath = resolve(projectRoot, 'packages', 'api', 'src', 'market', 'seeds', 'local-api.ts');
	const packageApplySourceModulePath = resolve(projectRoot, 'packages', 'api', 'src', 'market', 'seeds', 'apply.ts');
	const apiModulePath = [
		rootApiModulePath,
		packageApiDistModulePath,
		packageApiSourceModulePath,
	].find((candidate) => existsSync(candidate));
	const applyModulePath = [
		rootApplyModulePath,
		packageApplyDistModulePath,
		packageApplySourceModulePath,
	].find((candidate) => existsSync(candidate));
	if (!applyModulePath) {
		throw new Error('Local seed apply service is not available in this market project.');
	}
	const applyModule = await import(pathToFileURL(applyModulePath).href) as {
		applyLocalSeedFromCli?: LocalSeedApplyRunner;
		planLocalSeedFromCli?: LocalSeedPlanRunner;
		exportSeedFromCli?: LocalSeedExportRunner;
	};
	if (!apiModulePath) {
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

export async function requireLocalSeedSession(invocation: Parameters<CommandHandler>[0], context: Parameters<CommandHandler>[1]) {
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
					accessToken: localAcceptanceAdminToken(context.env),
					refreshToken: null,
					expiresAt: null,
					principal: {
						id: 'local-acceptance-admin',
						type: 'local_acceptance_admin',
						permissions: ['teams:manage:team'],
					},
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
						accessToken: localAcceptanceAdminToken(context.env),
						refreshToken: null,
						expiresAt: null,
						principal: {
							id: 'local-acceptance-admin',
							type: 'local_acceptance_admin',
							permissions: ['teams:manage:team'],
						},
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
					accessToken: localAcceptanceAdminToken(context.env),
					refreshToken: null,
					expiresAt: null,
					principal: {
						id: 'local-acceptance-admin',
						type: 'local_acceptance_admin',
						permissions: ['teams:manage:team'],
					},
				},
			};
		}
		throw new Error(`Login for market "${profile.id}" expired. Run treeseed auth:login --market ${profile.id}.`);
	}
	if (profile.id === 'local') {
		return {
			profile,
			session: {
				...session,
				accessToken: localAcceptanceAdminToken(context.env),
				principal: {
					id: 'local-acceptance-admin',
					type: 'local_acceptance_admin',
					permissions: ['teams:manage:team'],
				},
			},
		};
	}
	return { profile, session };
}

