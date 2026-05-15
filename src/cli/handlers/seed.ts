import type { TreeseedCommandHandler } from '../types.js';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatSeedDiagnostics, formatSeedPlan, loadAndPlanSeed, type SeedPlan } from '@treeseed/sdk/seeds';
import { MarketApiError } from '@treeseed/sdk/market-client';
import { createMarketClientForInvocation } from './market-utils.js';

type LocalSeedApplyRunner = (input: {
	projectRoot: string;
	seedName: string;
	environments?: string;
	plan: SeedPlan;
	env?: NodeJS.ProcessEnv;
}) => Promise<{ plan: SeedPlan; result: Record<string, unknown> }>;
type LocalSeedPlanRunner = (input: {
	projectRoot: string;
	seedName: string;
	environments?: string;
	mode?: SeedPlan['mode'];
	env?: NodeJS.ProcessEnv;
}) => Promise<{ plan: SeedPlan | null; diagnostics: unknown[]; manifestPath: string }>;
type LocalSeedExportRunner = (input: {
	projectRoot: string;
	seedName: string;
	team: string;
	environments?: string;
	includePrivate?: boolean;
	includeArtifacts?: boolean;
	env?: NodeJS.ProcessEnv;
}) => Promise<Record<string, unknown>>;

async function loadLocalSeedModule(projectRoot: string): Promise<{ applyLocalSeedFromCli?: LocalSeedApplyRunner; planLocalSeedFromCli?: LocalSeedPlanRunner; exportSeedFromCli?: LocalSeedExportRunner }> {
	const moduleUrl = pathToFileURL(resolve(projectRoot, 'src', 'lib', 'market', 'seeds', 'apply.js')).href;
	return await import(moduleUrl) as { applyLocalSeedFromCli?: LocalSeedApplyRunner; planLocalSeedFromCli?: LocalSeedPlanRunner; exportSeedFromCli?: LocalSeedExportRunner };
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
		diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics as SeedPlan['diagnostics'] : [],
		manifestPath: '',
	};
}

function remoteSeedResult(payload: Record<string, unknown>, command: string, exitCode = 0) {
	const plan = planFromRemotePayload(payload);
	return {
		exitCode,
		stdout: exitCode === 0
			? [
				...formatSeedPlan(plan),
				...(payload.result && typeof payload.result === 'object'
					? [
						'',
						'Apply:',
						`  created: ${plan.summary.create}`,
						`  updated: ${plan.summary.update}`,
						`  unchanged: ${plan.summary.unchanged}`,
						`  skipped: ${plan.summary.skip}`,
						`  failed: ${plan.summary.error}`,
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

function remoteSeedError(error: unknown, command: string) {
	if (error instanceof MarketApiError) {
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
			const localModule = await loadLocalSeedModule(context.cwd);
			if (typeof localModule.exportSeedFromCli !== 'function') {
				throw new Error('Local seed export service is not available in this market project.');
			}
			payload = await localModule.exportSeedFromCli({
				projectRoot: context.cwd,
				seedName,
				team,
				environments: typeof invocation.args.environments === 'string' ? invocation.args.environments : undefined,
				includePrivate: invocation.args.includePrivate === true,
				includeArtifacts: invocation.args.includeArtifacts === true,
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
			if (typeof localModule.planLocalSeedFromCli === 'function') {
				const localPlanned = await localModule.planLocalSeedFromCli({
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
		} catch {
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
		const localModule = await loadLocalSeedModule(context.cwd);
		if (typeof localModule.applyLocalSeedFromCli !== 'function') {
			throw new Error('Local seed apply service is not available in this market project.');
		}
		const runner = localModule.applyLocalSeedFromCli;
		const applied = await runner({
			projectRoot: context.cwd,
			seedName,
			environments: typeof invocation.args.environments === 'string' ? invocation.args.environments : undefined,
			plan: planned.plan,
			env: context.env,
		});
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
				],
			report: {
				...applied.plan,
				ok: true,
				command: 'seed',
				result: {
					message,
					...applied.result,
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
