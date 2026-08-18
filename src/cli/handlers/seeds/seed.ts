import type { CommandHandler } from '../../types.js';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatSeedDiagnostics, formatSeedPlan, loadAndPlanSeed, reconcileLocalSeedRuntime, type SeedPlan } from '@treeseed/sdk/seeds';
import { MarketClientError } from '@treeseed/sdk/market-client';
import { createMarketClientForInvocation, marketSelector } from '../content/market-utils.js';
import { resolveMarketIntegrationMode } from '../content/support/market-mode.js';
import { loadLocalSeedModule, requireLocalSeedSession } from '../accounts/seed-session.js';
import { handleSeedRepositories } from './seed-repositories.js';
import { handleSeedContentRepositories } from './migrations/seed-content-repositories.js';
import { handleSeedSourceRepositories } from './migrations/seed-source-repositories.js';
import { handleSeedPlatformWorkspace } from './migrations/seed-platform-workspace.js';
import { handleSeedSupportWorkflows } from './migrations/seed-support-workflows.js';
import { handleSeedLicenses } from './migrations/seed-licenses.js';
import { handleSeedAdminDescriptor } from './migrations/seed-admin-descriptor.js';
import { handleSeedGatewayContracts } from './migrations/seed-gateway-contracts.js';
import { handleSeedMarketApiWorkspace } from './migrations/seed-market-api-workspace.js';
import { handleSeedOrganizationReferences } from './migrations/seed-organization-references.js';

function seedRequestBody(invocation: Parameters<CommandHandler>[0]) {
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
		runtime: payload.runtime && typeof payload.runtime === 'object' ? payload.runtime as SeedPlan['runtime'] : { capacityProviders: [], agentLabServicePrincipals: [] },
		recipes: Array.isArray(payload.recipes) ? payload.recipes as SeedPlan['recipes'] : [],
		diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics as SeedPlan['diagnostics'] : [],
		manifestPath: '',
	};
}

export function localRuntimePlan(planned: SeedPlan, applied: SeedPlan): SeedPlan {
	return { ...applied, runtime: planned.runtime };
}

function remoteSeedResult(payload: Record<string, unknown>, command: string, exitCode = 0) {
	const plan = planFromRemotePayload(payload);
	const result = payload.result && typeof payload.result === 'object' ? payload.result as Record<string, unknown> : null;
	return {
		exitCode,
		stdout: exitCode === 0
			? [
				...formatSeedPlanWithProjectArchitecture(plan),
				...(result
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

function projectArchitectureLines(plan: SeedPlan) {
	const lines = plan.actions
		.filter((action) => action.kind === 'project' && action.action !== 'skip')
		.map((action) => {
			const architecture = action.payload?.architecture && typeof action.payload.architecture === 'object'
				? action.payload.architecture as Record<string, unknown>
				: null;
			if (!architecture) return null;
			return `  ${action.label}: ${String(architecture.topology ?? 'unknown')} site=${String(architecture.sitePath ?? '.')} content=${String(architecture.contentPath ?? '(none)')} runtime=${String(architecture.contentRuntimeSource ?? 'unknown')} local=${String(architecture.localContentMaterialization ?? 'none')}`;
		})
		.filter((line): line is string => Boolean(line));
	return lines.length > 0 ? ['', 'Project architecture:', ...lines] : [];
}

function formatSeedPlanWithProjectArchitecture(plan: SeedPlan) {
	const lines = formatSeedPlan(plan);
	const architecture = projectArchitectureLines(plan);
	if (architecture.length === 0) return lines;
	const summaryIndex = lines.findIndex((line) => line === 'Summary:');
	if (summaryIndex < 0) return [...lines, ...architecture];
	return [
		...lines.slice(0, summaryIndex),
		...architecture,
		...lines.slice(summaryIndex),
	];
}

function remoteSeedError(error: unknown, command: string) {
	if (error instanceof MarketClientError) {
		const payload = error.payload && typeof error.payload === 'object' ? error.payload as Record<string, unknown> : { error: error.message };
		const blocked = error.status === 409 || (payload.result as Record<string, unknown> | undefined)?.blocked === true;
		const auth = error.status === 401 || error.status === 403;
		return remoteSeedResult(payload, command, blocked ? 2 : auth ? 4 : 3);
	}
	if (error instanceof Error && 'payload' in error && error.payload && typeof error.payload === 'object') {
		const status = 'status' in error && typeof error.status === 'number' ? error.status : 500;
		const payload = error.payload as Record<string, unknown>;
		return remoteSeedResult(payload, command, status === 409 ? 2 : status === 401 || status === 403 ? 4 : 3);
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

function writeSeedExportOutput(context: Parameters<CommandHandler>[1], outputPath: string, yaml: string) {
	const destination = resolve(context.cwd, outputPath);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, yaml, 'utf8');
	return destination;
}

async function handleSeedExport(invocation: Parameters<CommandHandler>[0], context: Parameters<CommandHandler>[1]) {
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

export const handleSeed: CommandHandler = async (invocation, context) => {
	if (invocation.positionals[0] === 'platform-workspace') {
		return handleSeedPlatformWorkspace(invocation, context);
	}
	if (invocation.positionals[0] === 'support-workflows') {
		return handleSeedSupportWorkflows(invocation, context);
	}
	if (invocation.positionals[0] === 'licenses') {
		return handleSeedLicenses(invocation, context);
	}
	if (invocation.positionals[0] === 'admin-descriptor') {
		return handleSeedAdminDescriptor(invocation, context);
	}
	if (invocation.positionals[0] === 'gateway-contracts') {
		return handleSeedGatewayContracts(invocation, context);
	}
	if (invocation.positionals[0] === 'market-api-workspace') {
		return handleSeedMarketApiWorkspace(invocation, context);
	}
	if (invocation.positionals[0] === 'organization-references') {
		return handleSeedOrganizationReferences(invocation, context);
	}
	if (invocation.positionals[0] === 'source-repositories') {
		return handleSeedSourceRepositories(invocation, context);
	}
	if (invocation.positionals[0] === 'content-repositories') {
		return handleSeedContentRepositories(invocation, context);
	}
	if (invocation.positionals[0] === 'repositories') {
		return handleSeedRepositories(invocation, context);
	}
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
		if (planned.plan.actions.length === 0 && (
			planned.plan.runtime.capacityProviders.length > 0
			|| planned.plan.runtime.agentLabServicePrincipals.length > 0
		)) {
			const runtime = await reconcileLocalSeedRuntime({
				projectRoot: context.cwd,
				plan: planned.plan,
				accessToken: context.env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN?.trim() || 'tsk_local_treeseed_acceptance_admin',
				env: context.env,
			});
			return {
				exitCode: 0,
				stdout: context.outputFormat === 'json' ? [] : [...formatSeedPlanWithProjectArchitecture(planned.plan), '', 'Runtime prerequisites reconciled.'],
				report: {
					...planned.plan,
					ok: true,
					command: 'seed',
					result: { message: 'Local runtime-only seed apply completed.', runtime },
				},
			};
		}
		let localAuth: Awaited<ReturnType<typeof requireLocalSeedSession>>;
		try {
			localAuth = await requireLocalSeedSession(invocation, context);
		} catch (error) {
			return remoteSeedError(error, 'seed');
		}
		const localModule = await loadLocalSeedModule(context.cwd);
		const marketMode = resolveMarketIntegrationMode(context.cwd);
		const runner = !marketMode.enabled
			? localModule.applyLocalSeedFromCli ?? localModule.applyLocalSeedViaApiFromCli
			: localAuth.session.accessToken
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
		const runtime = await reconcileLocalSeedRuntime({
			projectRoot: context.cwd,
			plan: localRuntimePlan(planned.plan, applied.plan),
			accessToken: context.env.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN?.trim() || 'tsk_local_treeseed_acceptance_admin',
			env: context.env,
		});
		const safeResult = applied.result;
		const message = 'Local seed apply completed.';
		return {
			exitCode: 0,
			stdout: context.outputFormat === 'json'
				? []
				: [
					...formatSeedPlanWithProjectArchitecture(applied.plan),
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
					...safeResult,
					runtime,
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
		stdout: formatSeedPlanWithProjectArchitecture(planned.plan),
		report: {
			...planned.plan,
			command: 'seed',
		},
	};
};
