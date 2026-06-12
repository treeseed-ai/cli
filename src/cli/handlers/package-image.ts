import {
	createGitHubApiClient,
	dispatchGitHubWorkflowRun,
	ensureGitHubActionsEnvironment,
	getLatestGitHubWorkflowRun,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
	planTreeseedPackageDevelopmentImage,
	resolveGitHubCredentialForRepository,
	resolveTreeseedLaunchEnvironment,
	upsertGitHubEnvironmentSecret,
	upsertGitHubEnvironmentVariable,
} from '@treeseed/sdk/workflow-support';
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
	const planOnly = boolArg(invocation, 'plan') || !execute;
	const imagePlan = planTreeseedPackageDevelopmentImage(context.cwd, packageId, { branch });
	const selectedWorkflow = workflow ?? imagePlan.workflow;
	const configEnv = resolveTreeseedLaunchEnvironment({
		tenantRoot: context.cwd,
		scope: 'staging',
		baseEnv: context.env,
	});
	const dockerHub = {
		usernameConfigured: Boolean(String(configEnv.DOCKERHUB_USERNAME ?? '').trim()),
		tokenConfigured: Boolean(String(configEnv.DOCKERHUB_TOKEN ?? '').trim()),
		requiredSecrets: ['DOCKERHUB_TOKEN'],
		requiredVariables: ['DOCKERHUB_USERNAME'],
	};
	const credential = resolveGitHubCredentialForRepository(imagePlan.repository, { values: configEnv, env: context.env });
	const githubClientEnv = credential.token
		? { ...configEnv, GH_TOKEN: credential.token, GITHUB_TOKEN: credential.token }
		: configEnv;
	const report: Record<string, unknown> = {
		ok: true,
		action: planOnly ? 'plan' : 'dispatch',
		package: imagePlan.package,
		repository: imagePlan.repository,
		workflow: selectedWorkflow,
		branch: imagePlan.branch,
		refs: imagePlan.refs,
		credential: {
			repository: credential.repository,
			envName: credential.envName,
			configured: credential.configured,
			source: credential.source,
			fallbackUsed: credential.fallbackUsed,
		},
		dockerHub,
		hosting: imagePlan.hosting,
	};
	if (syncConfig) {
		const client = createGitHubApiClient({ env: githubClientEnv });
		const environment = imagePlan.hosting?.environment ?? 'staging';
		await ensureGitHubActionsEnvironment(imagePlan.repository, environment, {
			client,
			branchName: imagePlan.branch,
		});
		const [secretNames, variableNames] = await Promise.all([
			listGitHubEnvironmentSecretNames(imagePlan.repository, environment, { client }),
			listGitHubEnvironmentVariableNames(imagePlan.repository, environment, { client }),
		]);
		const synced = {
			environment,
			secrets: [] as Array<{ name: string; existed: boolean }>,
			variables: [] as Array<{ name: string; existed: boolean }>,
		};
		if (configEnv.DOCKERHUB_TOKEN) {
			await upsertGitHubEnvironmentSecret(imagePlan.repository, environment, 'DOCKERHUB_TOKEN', configEnv.DOCKERHUB_TOKEN, { client });
			synced.secrets.push({ name: 'DOCKERHUB_TOKEN', existed: secretNames.has('DOCKERHUB_TOKEN') });
		}
		if (configEnv.DOCKERHUB_USERNAME) {
			await upsertGitHubEnvironmentVariable(imagePlan.repository, environment, 'DOCKERHUB_USERNAME', configEnv.DOCKERHUB_USERNAME, { client });
			synced.variables.push({ name: 'DOCKERHUB_USERNAME', existed: variableNames.has('DOCKERHUB_USERNAME') });
		}
		report.syncedConfig = synced;
	}
	if (execute) {
		const client = createGitHubApiClient({ env: githubClientEnv });
		report.dispatch = await dispatchGitHubWorkflowRun(imagePlan.repository, {
			client,
			workflow: selectedWorkflow,
			branch: imagePlan.branch,
		});
		report.latestWorkflowRun = await getLatestGitHubWorkflowRun(imagePlan.repository, {
			client,
			workflow: selectedWorkflow,
			branch: imagePlan.branch,
		});
	}
	const json = jsonResult(invocation, context, report);
	if (json) return json;
	return guidedResult({
		command: options.commandName ?? 'package image',
		summary: execute ? 'Package development image workflow dispatched.' : 'Package development image plan ready.',
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
			{ title: 'Next', lines: imagePlan.hosting ? [imagePlan.hosting.command] : [] },
		],
		report,
	});
}

