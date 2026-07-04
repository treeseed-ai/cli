import {
	resolveTreeseedLaunchEnvironment,
	runTreeseedPackageImageWorkflow,
} from '@treeseed/sdk/workflow-support';
import {
	planTreeseedReconciliation,
	reconcileTreeseedTarget,
	type TreeseedDesiredUnit,
} from '@treeseed/sdk/reconcile';
import type { TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { fail, guidedResult } from './utils.js';

function stringArg(invocation: TreeseedParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, key: string) {
	return invocation.args[key] === true;
}

function jsonResult(invocation: TreeseedParsedInvocation, context: unknown, report: Record<string, unknown>) {
	if ((context as { outputFormat?: string }).outputFormat === 'json' || boolArg(invocation, 'json')) {
		return { exitCode: 0, stdout: [JSON.stringify(report, null, 2)], stderr: [], report };
	}
	return null;
}

function packageImageReconcileUnits(input: {
	packageId: string;
	packageRoot: string;
	repository: string;
	workflow: string;
	branch: string;
	roleImages?: Array<{ imageName: string; immutableRef: string; role: string }>;
	imageName?: string;
	dockerHubConfigured: boolean;
	syncConfig: boolean;
	execute: boolean;
}): TreeseedDesiredUnit[] {
	const identity = { project: 'treeseed', environment: 'staging', resource: 'package-image', name: input.packageId };
	const target = { kind: 'persistent' as const, scope: 'staging' as const };
	const units: TreeseedDesiredUnit[] = [];
	const githubEnvironmentId = `github-environment:${input.packageId}:staging`;
	const secretId = `github-secret-binding:${input.packageId}:staging:DOCKERHUB_TOKEN`;
	const variableId = `github-variable-binding:${input.packageId}:staging:DOCKERHUB_USERNAME`;
	if (input.syncConfig) {
		units.push({
			unitId: githubEnvironmentId,
			unitType: 'github-environment',
			provider: 'github',
			identity,
			target,
			logicalName: `${input.packageId} staging`,
			dependencies: [],
			spec: { packageId: input.packageId, packageRoot: input.packageRoot, repository: input.repository, environment: 'staging' },
			secrets: {},
			metadata: { packageId: input.packageId, resourceKind: 'github-environment' },
		}, {
			unitId: secretId,
			unitType: 'github-secret-binding',
			provider: 'github',
			identity,
			target,
			logicalName: `${input.packageId} staging DOCKERHUB_TOKEN`,
			dependencies: [githubEnvironmentId],
			spec: { packageId: input.packageId, packageRoot: input.packageRoot, repository: input.repository, environment: 'staging', secretName: 'DOCKERHUB_TOKEN', envName: 'TREESEED_DOCKERHUB_TOKEN' },
			secrets: {},
			metadata: { packageId: input.packageId, resourceKind: 'github-secret-binding' },
		}, {
			unitId: variableId,
			unitType: 'github-variable-binding',
			provider: 'github',
			identity,
			target,
			logicalName: `${input.packageId} staging DOCKERHUB_USERNAME`,
			dependencies: [githubEnvironmentId],
			spec: { packageId: input.packageId, packageRoot: input.packageRoot, repository: input.repository, environment: 'staging', variableName: 'DOCKERHUB_USERNAME', envName: 'TREESEED_DOCKERHUB_USERNAME' },
			secrets: {},
			metadata: { packageId: input.packageId, resourceKind: 'github-variable-binding' },
		});
	}
	const imageNames = input.roleImages?.map((entry) => entry.imageName) ?? (input.imageName ? [input.imageName] : []);
	for (const imageName of imageNames) {
		units.push({
			unitId: `package-image:${imageName}`,
			unitType: 'package-image',
			provider: 'dockerhub',
			identity,
			target,
			logicalName: imageName,
			dependencies: input.syncConfig ? [secretId, variableId] : [],
			spec: { packageId: input.packageId, packageRoot: input.packageRoot, repository: input.repository, environment: 'staging', image: imageName, requiredSecrets: ['DOCKERHUB_TOKEN'], requiredVariables: ['DOCKERHUB_USERNAME'] },
			secrets: {},
			metadata: { packageId: input.packageId, resourceKind: 'package-image' },
		});
	}
	if (input.execute) {
		units.push({
			unitId: `github-workflow-dispatch:${input.packageId}:staging:${input.workflow}`,
			unitType: 'github-workflow-dispatch',
			provider: 'github',
			identity,
			target,
			logicalName: `${input.packageId} ${input.workflow} @ ${input.branch}`,
			dependencies: [
				...(input.syncConfig ? [secretId, variableId] : []),
				...imageNames.map((imageName) => `package-image:${imageName}`),
			],
			spec: {
				packageId: input.packageId,
				packageRoot: input.packageRoot,
				repository: input.repository,
				workflow: input.workflow,
				branch: input.branch,
				inputs: {},
				wait: true,
				timeoutMs: 45 * 60 * 1000,
			},
			secrets: {},
			metadata: { packageId: input.packageId, resourceKind: 'github-workflow-dispatch' },
		});
	}
	return units;
}

export async function runPackageImageCommand(
	invocation: TreeseedParsedInvocation,
	context: Parameters<TreeseedCommandHandler>[1],
	options: { packageId?: string | null; commandName?: string } = {},
) {
	const packageId = options.packageId ?? stringArg(invocation, 'package') ?? stringArg(invocation, 'packageId');
	if (!packageId) {
		return fail('Missing --package. Use `trsd package image --package <package-id>`.');
	}
	const branch = stringArg(invocation, 'branch') ?? 'staging';
	const workflow = stringArg(invocation, 'workflow') ?? null;
	const execute = boolArg(invocation, 'execute');
	const syncConfig = boolArg(invocation, 'syncConfig');
	const resolvedEnv = resolveTreeseedLaunchEnvironment({
		tenantRoot: context.cwd,
		scope: 'staging',
		baseEnv: context.env,
	});
	const { imagePlan, selectedWorkflow, dockerHub, credential, report } = await runTreeseedPackageImageWorkflow({
		root: context.cwd,
		packageId,
		branch,
		workflow,
		execute,
		syncConfig,
		env: resolvedEnv,
	});
	if ((syncConfig || execute) && credential.fallbackUsed) {
		const scopedTokenMessage = [
			`Package image ${syncConfig ? 'config sync' : 'workflow dispatch'} for ${imagePlan.repository} requires repository-scoped GitHub token ${credential.envName}.`,
			'TREESEED_GITHUB_TOKEN is only a fallback for root/top-level workflows and is not accepted for package repository mutation.',
			`Store an Agent/package repo token through trsd config, then retry: npx trsd package image --package ${packageId} --branch ${branch} ${syncConfig ? '--sync-config' : '--execute'} --json`,
		].join(' ');
		report.ok = false;
		report.error = scopedTokenMessage;
		report.credential = {
			repository: credential.repository,
			envName: credential.envName,
			configured: credential.configured,
			source: credential.source,
			fallbackUsed: credential.fallbackUsed,
		};
		const json = jsonResult(invocation, context, report);
		if (json) return { ...json, exitCode: 1 };
		return fail(scopedTokenMessage);
	}
	if (syncConfig || execute) {
		const target = { kind: 'persistent' as const, scope: 'staging' as const };
		const units = packageImageReconcileUnits({
			packageId: imagePlan.package.id,
			packageRoot: imagePlan.package.path,
			repository: imagePlan.repository,
			workflow: selectedWorkflow,
			branch: imagePlan.branch,
			roleImages: imagePlan.refs.roleImages,
			imageName: imagePlan.refs.imageName,
			dockerHubConfigured: dockerHub.usernameConfigured && dockerHub.tokenConfigured,
			syncConfig,
			execute,
		});
		const reconcile = execute
			? await reconcileTreeseedTarget({
				tenantRoot: context.cwd,
				target,
				env: resolvedEnv,
				units,
				planOnly: false,
				write: (line) => context.write(`[package-image] ${line}`, 'stderr'),
			})
			: await planTreeseedReconciliation({
				tenantRoot: context.cwd,
				target,
				env: resolvedEnv,
				units,
				write: (line) => context.write(`[package-image] ${line}`, 'stderr'),
			});
		report.reconcile = reconcile;
		report.ok = execute
			? (reconcile as Awaited<ReturnType<typeof reconcileTreeseedTarget>>).ok
			: !(reconcile as Awaited<ReturnType<typeof planTreeseedReconciliation>>).plans.some((plan) => plan.diff.action === 'blocked');
		delete report.dispatch;
	}
	const json = jsonResult(invocation, context, report);
	if (json) return json;
	return guidedResult({
		command: options.commandName ?? 'package image',
		summary: execute ? 'Package image workflow dispatched.' : 'Package deployment source/image plan ready.',
		facts: [
			{ label: 'Package', value: `${imagePlan.package.id} (${imagePlan.package.path})` },
			{ label: 'Workflow', value: `${selectedWorkflow} @ ${imagePlan.branch}` },
			{ label: 'Image', value: imagePlan.refs.imageRef },
			{ label: 'Moving tag', value: imagePlan.refs.movingImageRef ?? 'disabled' },
			{ label: 'GitHub credential', value: credential.configured ? `${credential.envName}${credential.fallbackUsed ? ' (fallback)' : ''}` : `${credential.envName} missing` },
			{ label: 'Docker Hub config', value: dockerHub.usernameConfigured && dockerHub.tokenConfigured ? 'configured' : 'missing' },
			{ label: 'Hosting override', value: imagePlan.hosting ? `${imagePlan.hosting.overrideEnvVar}=${imagePlan.refs.imageRef}` : 'not declared' },
		],
		sections: [
			...(imagePlan.refs.roleImages
				? [{
					title: 'Role images',
					lines: imagePlan.refs.roleImages.map((entry) => [
						entry.role,
						entry.immutableRef,
						entry.movingRef ? `moving ${entry.movingRef}` : 'moving disabled',
					].join(' | ')),
				}]
				: []),
			{ title: 'Next', lines: imagePlan.hosting ? [imagePlan.hosting.command] : [] },
		],
		report,
	});
}
