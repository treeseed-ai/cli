import type { TreeseedCommandHandler } from '../types.js';
import { applyTreeseedEnvironmentToProcess } from '@treeseed/sdk/workflow-support';
import {
	assertDeploymentInitialized,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	runRemoteD1Migrations,
} from '@treeseed/sdk/workflow-support';
import {
	configuredRailwayServices,
	deployRailwayService,
	validateRailwayDeployPrerequisites,
} from '@treeseed/sdk/workflow-support';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from '@treeseed/sdk/workflow-support';
import { packageScriptPath, resolveWranglerBin } from '@treeseed/sdk/workflow-support';
import { runTenantDeployPreflight } from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';

function inferEnvironmentFromBranch(tenantRoot: string) {
	const branch = currentManagedBranch(tenantRoot);
	if (branch === STAGING_BRANCH) return 'staging';
	if (branch === PRODUCTION_BRANCH) return 'prod';
	return null;
}

export const handleDeploy: TreeseedCommandHandler = (invocation, context) => {
	const commandName = invocation.commandName || 'deploy';
	const tenantRoot = context.cwd;
	const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment : undefined;
	const targetBranch = typeof invocation.args.targetBranch === 'string' ? invocation.args.targetBranch : undefined;
	const dryRun = invocation.args.dryRun === true;
	const only = typeof invocation.args.only === 'string' ? invocation.args.only : null;
	const name = typeof invocation.args.name === 'string' ? invocation.args.name : null;

	const target = targetBranch
		? createBranchPreviewDeployTarget(targetBranch)
		: createPersistentDeployTarget(environment ?? (context.env.CI ? inferEnvironmentFromBranch(tenantRoot) : null));
	const scope = targetBranch ? 'staging' : String(environment ?? (context.env.CI ? inferEnvironmentFromBranch(tenantRoot) : ''));
	const executedSteps: string[] = [];
	const nextSteps: string[] = [];
	let deployUrl: string | null = null;
	let migratedDatabase: string | null = null;

	const appliedEnv = applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });

	const allowedSteps = new Set(['migrate', 'build', 'publish', 'api', 'agents']);
	if (only && !allowedSteps.has(only)) {
		throw new Error(`Unsupported deploy step "${only}". Expected one of ${[...allowedSteps].join(', ')}.`);
	}

	const shouldRun = (step: string) => !only || only === step;
	const serviceResults: Array<Record<string, unknown>> = [];

	if (scope === 'local') {
		runTenantDeployPreflight({ cwd: tenantRoot, scope: 'local' });
		const buildOnly = context.spawn(process.execPath, [packageScriptPath('tenant-build')], {
			cwd: tenantRoot,
			env: { ...context.env, ...appliedEnv },
			stdio: 'inherit',
		});
		return guidedResult({
			command: commandName,
			summary: buildOnly.status === 0 ? 'Treeseed local deploy completed as a build-only publish target.' : 'Treeseed local deploy failed.',
			exitCode: buildOnly.status ?? 1,
			facts: [
				{ label: 'Target', value: 'local' },
				{ label: 'Dry run', value: dryRun ? 'yes' : 'no' },
			],
			nextSteps: buildOnly.status === 0 ? ['treeseed preview', 'treeseed save "describe your change"'] : ['treeseed doctor'],
			report: {
				target: 'local',
				dryRun,
				only,
				name,
				executedSteps: ['build'],
			},
		});
	}

	assertDeploymentInitialized(tenantRoot, { target });
	runTenantDeployPreflight({ cwd: tenantRoot, scope });
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	const managedRailwayServices = configuredRailwayServices(tenantRoot, scope).filter((service) => shouldRun(service.key));
	if (managedRailwayServices.length > 0 && !dryRun) {
		validateRailwayDeployPrerequisites(tenantRoot, scope);
	}

	if (shouldRun('migrate')) {
		const result = runRemoteD1Migrations(tenantRoot, { dryRun, target });
		executedSteps.push('migrate');
		migratedDatabase = result.databaseName;
	}

	if (shouldRun('build')) {
		if (dryRun) {
			executedSteps.push('build');
		} else {
			const buildResult = context.spawn(process.execPath, [packageScriptPath('tenant-build')], {
				cwd: tenantRoot,
				env: { ...context.env, ...appliedEnv },
				stdio: 'inherit',
			});
			if ((buildResult.status ?? 1) !== 0) {
				return { exitCode: buildResult.status ?? 1 };
			}
			executedSteps.push('build');
		}
	}

	if (shouldRun('publish')) {
		if (dryRun) {
			executedSteps.push('publish');
		} else {
			const publishResult = context.spawn(process.execPath, [resolveWranglerBin(), 'deploy', '--config', wranglerPath], {
				cwd: tenantRoot,
				env: { ...context.env, ...appliedEnv },
				stdio: 'inherit',
			});
			if ((publishResult.status ?? 1) !== 0) {
				return { exitCode: publishResult.status ?? 1 };
			}
			executedSteps.push('publish');
		}
	}

	for (const service of managedRailwayServices) {
		const result = deployRailwayService(tenantRoot, service, { dryRun });
		executedSteps.push(service.key);
		serviceResults.push(result);
	}

	if (!dryRun && (shouldRun('publish') || serviceResults.length > 0)) {
		const finalizedState = finalizeDeploymentState(tenantRoot, { target, serviceResults });
		deployUrl = finalizedState.lastDeployedUrl ?? null;
	}

	if (scope === 'staging') {
		nextSteps.push('treeseed release --patch');
	}
	if (scope !== 'local') {
		nextSteps.push(`treeseed status`);
	}

	return guidedResult({
		command: commandName,
		summary: dryRun ? `Treeseed ${commandName} dry run completed for ${deployTargetLabel(target)}.` : `Treeseed ${commandName} completed for ${deployTargetLabel(target)}.`,
		facts: [
			{ label: 'Target', value: deployTargetLabel(target) },
			{ label: 'Target label', value: name ?? '(none)' },
			{ label: 'Dry run', value: dryRun ? 'yes' : 'no' },
			{ label: 'Executed steps', value: executedSteps.join(', ') || '(none)' },
			{ label: 'Migrated database', value: migratedDatabase ?? '(none)' },
			{ label: 'Preview URL', value: deployUrl ?? (dryRun ? '(dry run)' : '(not reported)') },
			{ label: 'Managed services', value: serviceResults.map((entry) => `${entry.service}:${entry.status}`).join(', ') || '(none)' },
		],
		nextSteps,
		report: {
			target: deployTargetLabel(target),
			scope,
			dryRun,
			only,
			name,
			wranglerPath,
			executedSteps,
			migratedDatabase,
			deployUrl,
			serviceResults,
		},
	});
};
