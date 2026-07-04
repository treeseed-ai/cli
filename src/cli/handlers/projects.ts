import { MarketClientError } from '@treeseed/sdk/market-client';
import {
	githubRepositoryCredentialEnvName,
	parseProjectLaunchHostBindingSpecs,
	planTreeseedRepositoryImport,
} from '@treeseed/sdk';
import type { ProjectDeploymentEnvironment, ProjectWebDeploymentAction } from '@treeseed/sdk';
import type { TreeseedCommandContext, TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { fail, guidedResult } from './utils.js';
import { createMarketClientForInvocation } from './market-utils.js';

const DEPLOYMENT_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const FORBIDDEN_OUTPUT_FIELDS = new Set([
	'capacityProviderId',
	'laneId',
	'grantId',
	'workerPoolId',
	'runtimeHostId',
	'railwayServiceId',
	'runnerToken',
]);

const ACTIONS: Record<string, ProjectWebDeploymentAction> = {
	deploy: 'deploy_web',
	publish: 'publish_content',
	monitor: 'monitor',
};

function stringArg(invocation: TreeseedParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, key: string) {
	return invocation.args[key] === true;
}

function environmentArg(invocation: TreeseedParsedInvocation): ProjectDeploymentEnvironment {
	const value = stringArg(invocation, 'environment') ?? 'staging';
	return value === 'prod' ? 'prod' : 'staging';
}

function projectUsage(action: string) {
	switch (action) {
		case 'deploy':
			return 'Usage: treeseed projects deploy <project-id> --environment staging|prod';
		case 'publish':
			return 'Usage: treeseed projects publish <project-id> --environment staging|prod';
		case 'monitor':
			return 'Usage: treeseed projects monitor <project-id> --environment staging|prod';
		case 'deployments':
			return 'Usage: treeseed projects deployments <project-id>';
		case 'deployment':
			return 'Usage: treeseed projects deployment <project-id> <deployment-id>';
		case 'hosts':
			return 'Usage: treeseed projects hosts [audit|replace|resync|rotate] <project-id> [--host <requirement=provider:host-id|managed>]';
		case 'import':
			return 'Usage: treeseed projects import <owner/repo> --team <team-slug-or-id> [--plan|--execute]';
		default:
			return 'Usage: treeseed projects [list|access|hosts|import|deploy|publish|monitor|deployments|deployment]';
	}
}

function authFailure(error: unknown) {
	if (error instanceof MarketClientError && [401, 403].includes(error.status)) {
		return fail(error.message, 2);
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/not logged in|unauthori[sz]ed|forbidden/iu.test(message)) {
		return fail(message, 2);
	}
	return null;
}

function deploymentApiExitCode(error: unknown) {
	if (error instanceof MarketClientError) {
		if ([401, 403].includes(error.status)) return 2;
		const payload = error.payload as any;
		const code = payload?.error?.code ?? payload?.code;
		if (code === 'operation_not_retryable' || code === 'operation_not_cancellable') return 1;
	}
	return 1;
}

function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => redact(item));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([key]) => !FORBIDDEN_OUTPUT_FIELDS.has(key))
		.filter(([key]) => !/(?:secret|token|password|apiKey|privateKey)/iu.test(key))
		.map(([key, entry]) => [key, redact(entry)]));
}

function text(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function actionLabel(action: unknown) {
	switch (action) {
		case 'deploy_web': return 'deploy_web';
		case 'publish_content': return 'publish_content';
		case 'monitor': return 'monitor';
		default: return text(action, 'deployment');
	}
}

function deploymentUrl(deployment: any) {
	return text(deployment?.target?.url, text(deployment?.target?.previewUrl, ''));
}

function workflowUrl(deployment: any) {
	return text(deployment?.externalWorkflow?.url, text(deployment?.externalWorkflow?.htmlUrl, text(deployment?.externalWorkflow?.runUrl, '')));
}

function inspectCommand(projectId: string, deploymentId: string) {
	return `trsd projects deployment ${projectId} ${deploymentId}`;
}

function retryCommand(projectId: string, deploymentId: string) {
	return `trsd projects deployment retry ${projectId} ${deploymentId}`;
}

function deploymentLine(deployment: any) {
	return [
		deployment.id,
		deployment.environment,
		actionLabel(deployment.action),
		deployment.status,
		deployment.monitor?.status ? `monitor=${deployment.monitor.status}` : '',
		deployment.completedAt ?? deployment.finishedAt ?? deployment.updatedAt ?? '',
		workflowUrl(deployment),
		deploymentUrl(deployment),
	].filter(Boolean).join('  ');
}

function architectureSummary(project: any) {
	const architecture = project?.architecture && typeof project.architecture === 'object'
		? project.architecture
		: project?.metadata?.architecture && typeof project.metadata.architecture === 'object'
			? project.metadata.architecture
			: null;
	if (!architecture) return 'architecture=(not recorded)';
	return [
		`topology=${architecture.topology ?? 'unknown'}`,
		`site=${architecture.sitePath ?? '.'}`,
		`content=${architecture.contentPath ?? '(none)'}`,
		`runtime=${architecture.contentRuntimeSource ?? 'unknown'}`,
		`local=${architecture.localContentMaterialization ?? 'none'}`,
	].join(' ');
}

function normalizeRepeatable(value: unknown) {
	if (Array.isArray(value)) return value.map(String).filter((entry) => entry.trim());
	return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function hostBindingLine(entry: any) {
	const binding = entry?.binding ?? {};
	const audit = entry?.audit ?? {};
	return [
		entry.requirementKey,
		entry.required ? 'required' : 'optional',
		entry.type,
		binding.provider ?? '(none)',
		binding.hostId ?? binding.managedHostKey ?? '(not selected)',
		audit.status ?? 'ok',
	].filter(Boolean).join('  ');
}

function operationFacts(projectId: string, response: any) {
	const operation = response.operation ?? null;
	return [
		{ label: 'Project', value: projectId },
		{ label: 'Operation', value: operation?.id ?? null },
		{ label: 'Status', value: operation?.status ?? null },
		{ label: 'Poll', value: operation?.pollUrl ?? null },
	].filter((fact) => fact.value != null && fact.value !== '');
}

function hostBindingForMarket(parsed: ReturnType<typeof parseProjectLaunchHostBindingSpecs>, requirementKey: string) {
	const summary = parsed.summaries.find((entry) => entry.requirementKey === requirementKey)
		?? parsed.omitted.find((entry) => entry.requirementKey === requirementKey);
	const binding = parsed.hostBindings[requirementKey];
	if (summary?.mode === 'none') {
		return {
			requirementKey,
			requirementKind: 'host',
			type: summary.type,
			provider: summary.provider ?? '',
			hostId: null,
			managedHostKey: null,
			mode: 'none',
			selectedBy: 'user',
		};
	}
	if (!binding || !summary) return null;
	return {
		...binding,
		hostId: summary.mode === 'team_owned' ? summary.alias : null,
		managedHostKey: summary.mode === 'treeseed_managed' ? (summary.alias === 'managed' ? binding.managedHostKey : summary.alias) : null,
		displayName: summary.displayName,
		environmentScopes: binding.environmentScopes?.filter((scope) => scope !== 'local') ?? ['staging', 'prod'],
	};
}

function waitExitCode(status: string) {
	if (status === 'succeeded') return 0;
	if (status === 'timed_out') return 4;
	if (status === 'cancelled') return 5;
	return 3;
}

function monitorExitCode(deployment: any, fallback: number) {
	if (deployment?.monitor?.status === 'failed') return 3;
	if (['healthy', 'degraded', 'unknown'].includes(String(deployment?.monitor?.status))) return 0;
	return fallback;
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDeployment(input: {
	client: any;
	projectId: string;
	deploymentId: string;
	timeoutSeconds: number;
	pollIntervalMs: number;
}) {
	const started = Date.now();
	let current = (await input.client.projectDeployment(input.projectId, input.deploymentId)).payload;
	while (!DEPLOYMENT_TERMINAL_STATUSES.has(String(current.status))) {
		if (Date.now() - started >= input.timeoutSeconds * 1000) {
			return {
				exitCode: 4,
				deployment: current,
				timedOut: true,
			};
		}
		await delay(input.pollIntervalMs);
		current = (await input.client.projectDeployment(input.projectId, input.deploymentId)).payload;
	}
	return {
		exitCode: waitExitCode(String(current.status)),
		deployment: current,
		timedOut: false,
	};
}

function timeoutSeconds(invocation: TreeseedParsedInvocation) {
	const value = Number(stringArg(invocation, 'timeoutSeconds') ?? 300);
	return Number.isFinite(value) && value > 0 ? value : 300;
}

function pollIntervalMs(invocation: TreeseedParsedInvocation) {
	const value = Number(stringArg(invocation, 'pollIntervalMs') ?? 1000);
	return Number.isFinite(value) && value > 0 ? value : 1000;
}

function normalizeGitHubRepositorySlug(repository: string) {
	return repository.trim()
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
}

async function observeGitHubRepository(repository: string, env: Record<string, string | undefined>) {
	const slug = normalizeGitHubRepositorySlug(repository);
	const [owner, name] = slug.split('/');
	if (!owner || !name) return null;
	const scopedEnvName = githubRepositoryCredentialEnvName(slug);
	const token = env[scopedEnvName] || env.TREESEED_GITHUB_TOKEN || '';
	const headers: Record<string, string> = {
		accept: 'application/vnd.github+json',
		'user-agent': 'treeseed-project-import',
	};
	if (token) headers.authorization = `Bearer ${token}`;
	try {
		const repoResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { headers });
		if (!repoResponse.ok) return null;
		const repo = await repoResponse.json() as any;
		const defaultBranch = typeof repo.default_branch === 'string' ? repo.default_branch : 'main';
		const treeResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, { headers });
		const tree = treeResponse.ok ? await treeResponse.json() as any : null;
		const entries = Array.isArray(tree?.tree) ? tree.tree : [];
		return {
			provider: 'github',
			owner,
			name,
			defaultBranch,
			visibility: repo.private === true ? 'private' : 'public',
			htmlUrl: typeof repo.html_url === 'string' ? repo.html_url : `https://github.com/${slug}`,
			cloneUrl: typeof repo.clone_url === 'string' ? repo.clone_url : `https://github.com/${slug}.git`,
			files: entries.filter((entry: any) => entry?.type === 'blob').map((entry: any) => String(entry.path)),
			directories: entries.filter((entry: any) => entry?.type === 'tree').map((entry: any) => String(entry.path)),
		};
	} catch {
		return null;
	}
}

async function handleProjectImport(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext) {
	const repository = invocation.positionals[1];
	const team = stringArg(invocation, 'team');
	if (!repository || !team) return fail(projectUsage('import'));
	const observation = await observeGitHubRepository(repository, process.env);
	const plan = planTreeseedRepositoryImport({
		team,
		repository,
		observation: observation ?? undefined,
		rootPath: stringArg(invocation, 'rootPath') ?? undefined,
		sitePath: stringArg(invocation, 'sitePath') ?? undefined,
		contentPath: stringArg(invocation, 'contentPath') ?? undefined,
		visibility: stringArg(invocation, 'visibility') ?? undefined,
		credentialRef: stringArg(invocation, 'credentialRef') ?? undefined,
		env: process.env,
	});
	if (!observation) {
		plan.diagnostics.push({
			severity: 'warning',
			code: 'github_observation_unavailable',
			message: 'GitHub repository observation was unavailable; the plan uses explicit overrides and safe defaults.',
		});
	}
	if (!boolArg(invocation, 'execute')) {
		return guidedResult({
			command: 'projects import',
			summary: 'Treeseed project import plan',
			facts: [
				{ label: 'Repository', value: plan.repository.slug },
				{ label: 'Team', value: plan.team },
				{ label: 'Site path', value: plan.architecture.sitePath },
				{ label: 'Content path', value: plan.architecture.contentPath ?? '(none)' },
				{ label: 'Credential', value: plan.credentialRef },
			],
			sections: [{
				title: 'Diagnostics',
				lines: plan.diagnostics.map((entry) => `${entry.severity}  ${entry.code}  ${entry.message}`),
			}],
			report: { projectImport: redact(plan) },
		});
	}
	let market;
	try {
		market = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	} catch (error) {
		return authFailure(error) ?? fail(error instanceof Error ? error.message : String(error), 1);
	}
	const response = await market.client.importProjectRepository(team, plan);
	return guidedResult({
		command: 'projects import',
		summary: 'Treeseed project import applied',
		facts: [
			{ label: 'Repository', value: plan.repository.slug },
			{ label: 'Team', value: plan.team },
			{ label: 'Project', value: (response.payload as any).project?.id ?? (response.payload as any).project?.slug ?? null },
			{ label: 'Site path', value: plan.architecture.sitePath },
			{ label: 'Content path', value: plan.architecture.contentPath ?? '(none)' },
		],
		report: { marketId: market.profile.id, response: redact(response.payload) },
	});
}

function deploymentRequestBody(invocation: TreeseedParsedInvocation, action: ProjectWebDeploymentAction, environment: ProjectDeploymentEnvironment) {
	const body: Record<string, unknown> = {
		environment,
		action,
		source: 'cli',
	};
	const reason = stringArg(invocation, 'reason');
	const idempotencyKey = stringArg(invocation, 'idempotencyKey');
	if (reason) body.reason = reason;
	if (idempotencyKey) body.idempotencyKey = idempotencyKey;
	if (environment === 'prod' && action !== 'monitor') body.confirmProduction = true;
	return body;
}

function monitorFacts(deployment: any) {
	const monitor = deployment?.monitor && typeof deployment.monitor === 'object' ? deployment.monitor : null;
	if (!monitor) return [];
	return [
		{ label: 'Monitor', value: monitor.status ?? null },
		{ label: 'Checked', value: monitor.checkedAt ?? null },
		{ label: 'Checks', value: Array.isArray(monitor.checks) ? `${monitor.checks.filter((check: any) => check.status === 'passed').length} passed, ${monitor.checks.filter((check: any) => check.status === 'warning').length} warnings, ${monitor.checks.filter((check: any) => check.status === 'failed').length} failed` : null },
	];
}

function monitorSection(deployment: any) {
	const checks = Array.isArray(deployment?.monitor?.checks) ? deployment.monitor.checks : [];
	if (checks.length === 0) return [];
	return [{
		title: 'Monitor checks',
		lines: checks.map((check: any) => [
			check.status ?? 'skipped',
			check.key ?? check.label ?? 'check',
			check.summary ?? '',
			check.inspectCommand ?? check.url ?? '',
		].filter(Boolean).join('  ')),
	}];
}

export const handleProjects: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	if (action === 'import') {
		try {
			return await handleProjectImport(invocation, context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return guidedResult({
				command: 'projects import',
				summary: message,
				exitCode: 1,
				stderr: [message],
				report: { ok: false, error: message },
			});
		}
	}
	let market;
	try {
		market = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	} catch (error) {
		return authFailure(error) ?? fail(error instanceof Error ? error.message : String(error), 1);
	}
	const { profile, client } = market;

	try {
		if (action === 'list') {
			const teamId = typeof invocation.args.team === 'string' ? invocation.args.team : null;
			const response = await client.projects(teamId);
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed market projects',
				sections: [{
					title: 'Projects',
					lines: response.payload.map((project: any) => `${project.id}  ${project.name ?? project.slug}  team=${project.teamId}  ${architectureSummary(project)}`),
				}],
				report: { marketId: profile.id, teamId, projects: redact(response.payload) },
			});
		}
		if (action === 'access') {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			const response = await client.projectAccess(projectId);
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed market project access',
				facts: [
					{ label: 'Project', value: response.payload.projectId },
					{ label: 'Staging admin', value: response.payload.team.summary.canAdminStaging },
					{ label: 'Production admin', value: response.payload.team.summary.canAdminProduction },
				],
				sections: [{
					title: 'Environments',
					lines: response.payload.environments.map((entry) => `${entry.environment}: ${entry.role}`),
				}],
				report: { marketId: profile.id, access: redact(response.payload) },
			});
		}
		if (action === 'hosts') {
			const subaction = ['audit', 'replace', 'resync', 'rotate'].includes(String(invocation.positionals[1]))
				? String(invocation.positionals[1])
				: 'list';
			const projectId = subaction === 'list' ? invocation.positionals[1] : invocation.positionals[2];
			if (!projectId) return fail(projectUsage(action));
			if (subaction === 'list') {
				const response = await client.projectHosts(projectId);
				const view = (response.payload as any).view ?? {};
				return guidedResult({
					command: 'projects',
					summary: 'Treeseed project host bindings',
					facts: [
						{ label: 'Project', value: projectId },
						{ label: 'Status', value: view.summary?.status ?? 'ok' },
						{ label: 'Requirements', value: view.summary?.total ?? 0 },
					],
					sections: [{
						title: 'Host requirements',
						lines: (view.requirements ?? []).map(hostBindingLine),
					}],
					report: { marketId: profile.id, projectId, hosts: redact(response.payload) },
				});
			}
			if (subaction === 'audit') {
				const response = await client.auditProjectHosts(projectId, {
					idempotencyKey: stringArg(invocation, 'idempotencyKey'),
				});
				const view = (response.payload as any).view ?? {};
				return guidedResult({
					command: 'projects',
					summary: 'Treeseed project host audit',
					facts: [
						{ label: 'Project', value: projectId },
						{ label: 'Status', value: view.summary?.status ?? 'ok' },
						{ label: 'Warnings', value: view.summary?.warnings ?? 0 },
						{ label: 'Blocked', value: view.summary?.blocked ?? 0 },
					],
					sections: [{
						title: 'Diagnostics',
						lines: (view.diagnostics ?? []).map((entry: any) => `${entry.status}  ${entry.requirementKey ?? ''}  ${entry.message}`),
					}],
					report: { marketId: profile.id, projectId, audit: redact(response.payload) },
				});
			}
			const hostSpecs = normalizeRepeatable(invocation.args.host);
			const hostSnapshot = await client.projectHosts(projectId);
			const launchRequirements = (hostSnapshot.payload as any).launchRequirements ?? null;
			let requirementKey = stringArg(invocation, 'requirement');
			let hostBinding: Record<string, unknown> | null = null;
			if (subaction === 'replace') {
				if (hostSpecs.length !== 1) return fail('Host replacement requires exactly one --host <requirement=provider:host-id|managed> spec.');
				try {
					const parsed = parseProjectLaunchHostBindingSpecs({ specs: hostSpecs, launchRequirements });
					requirementKey = requirementKey ?? parsed.summaries[0]?.requirementKey ?? parsed.omitted[0]?.requirementKey ?? null;
					if (!requirementKey) return fail('Host replacement could not determine a launch requirement key.');
					hostBinding = hostBindingForMarket(parsed, requirementKey);
					if (!hostBinding) return fail('Host replacement could not normalize the selected host binding.');
				} catch (error) {
					return fail(error instanceof Error ? error.message : String(error));
				}
			}
			if (!requirementKey) return fail(`${subaction} requires --requirement <key>.`);
			if (stringArg(invocation, 'sensitivePassphrase')) {
				return fail('Project host operations no longer accept --sensitive-passphrase. Re-enter or migrate the host secret into an approved target, then retry the operation.');
			}
			const body = {
				...(hostBinding ? { hostBinding } : {}),
				...(stringArg(invocation, 'idempotencyKey') ? { idempotencyKey: stringArg(invocation, 'idempotencyKey') } : {}),
			};
			const response = subaction === 'replace'
				? await client.replaceProjectHost(projectId, requirementKey, body)
				: subaction === 'resync'
					? await client.resyncProjectHost(projectId, requirementKey, body)
					: await client.rotateProjectHost(projectId, requirementKey, body);
			const view = (response.payload as any).view ?? {};
			return guidedResult({
				command: 'projects',
				summary: `Treeseed project host ${subaction} queued`,
				facts: operationFacts(projectId, response),
				sections: [{
					title: 'Host requirements',
					lines: (view.requirements ?? []).map(hostBindingLine),
				}],
				nextSteps: response.operation?.id ? [`trsd projects hosts ${projectId}`, `trsd operations ${response.operation.id}`] : [`trsd projects hosts ${projectId}`],
				report: { marketId: profile.id, projectId, response: redact(response) as Record<string, unknown> },
			});
		}
		if (action === 'connect') {
			return fail('Use treeseed config --connect-market --market-project-id <project-id> for project pairing.');
		}
		if (action in ACTIONS) {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			const environment = environmentArg(invocation);
			const deploymentAction = ACTIONS[action];
			if (environment === 'prod' && deploymentAction !== 'monitor' && !boolArg(invocation, 'yes')) {
				return fail(`Production ${action} requires --yes and was not queued.`);
			}
			const response = await client.createProjectWebDeployment(projectId, deploymentRequestBody(invocation, deploymentAction, environment));
			let deployment = response.deployment;
			let waitResult: Awaited<ReturnType<typeof waitForDeployment>> | null = null;
			if (boolArg(invocation, 'wait')) {
				waitResult = await waitForDeployment({
					client,
					projectId,
					deploymentId: deployment.id,
					timeoutSeconds: timeoutSeconds(invocation),
					pollIntervalMs: pollIntervalMs(invocation),
				});
				deployment = waitResult.deployment;
			}
			const exitCode = monitorExitCode(deployment, waitResult?.exitCode ?? 0);
			const summary = waitResult
				? waitResult.timedOut
					? 'Treeseed project deployment wait timed out'
					: deployment.status === 'succeeded'
						? 'Treeseed project deployment completed'
						: `Treeseed project deployment ${deployment.status}`
				: 'Treeseed project deployment queued';
			const nextSteps = [
				inspectCommand(projectId, deployment.id),
				...(['failed', 'timed_out', 'cancelled'].includes(deployment.status) ? [retryCommand(projectId, deployment.id)] : []),
			];
			return guidedResult({
				command: 'projects',
				summary,
				exitCode,
				facts: [
					{ label: 'Project', value: projectId },
					{ label: 'Environment', value: deployment.environment },
					{ label: 'Action', value: deployment.action },
					{ label: 'Deployment', value: deployment.id },
					{ label: 'Operation', value: deployment.platformOperationId ?? (response.operation as any)?.id ?? null },
					{ label: 'Status', value: deployment.status },
					{ label: 'URL', value: deploymentUrl(deployment) || null },
					{ label: 'Workflow', value: workflowUrl(deployment) || null },
					...monitorFacts(deployment),
				],
				sections: monitorSection(deployment),
				nextSteps,
				report: {
					marketId: profile.id,
					projectId,
					deployment: redact(deployment),
					operation: redact(response.operation),
					pollUrl: response.pollUrl,
					eventsUrl: response.eventsUrl,
					stateUrl: response.stateUrl,
					wait: waitResult ? { timedOut: waitResult.timedOut, exitCode } : null,
				},
			});
		}
		if (action === 'deployments') {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			const response = await client.projectDeployments(projectId, {
				environment: stringArg(invocation, 'environment'),
				limit: stringArg(invocation, 'limit'),
			});
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed project deployments',
				sections: [{
					title: 'Deployments',
					lines: response.payload.map(deploymentLine),
				}],
				report: { marketId: profile.id, projectId, deployments: redact(response.payload) },
			});
		}
		if (action === 'deployment') {
			const subaction = invocation.positionals[1];
			const projectId = ['retry', 'resume', 'cancel'].includes(String(subaction)) ? invocation.positionals[2] : invocation.positionals[1];
			const deploymentId = ['retry', 'resume', 'cancel'].includes(String(subaction)) ? invocation.positionals[3] : invocation.positionals[2];
			if (!projectId || !deploymentId) return fail(projectUsage(action));
			if (subaction === 'retry') {
				const response = await client.retryProjectDeployment(projectId, deploymentId, {
					...(stringArg(invocation, 'idempotencyKey') ? { idempotencyKey: stringArg(invocation, 'idempotencyKey') } : {}),
				});
				return guidedResult({
					command: 'projects',
					summary: 'Treeseed project deployment retry queued',
					facts: [
						{ label: 'Original deployment', value: response.originalDeployment.id },
						{ label: 'Retry deployment', value: response.retryDeployment.id },
						{ label: 'Operation', value: (response.operation as any)?.id ?? response.retryDeployment.platformOperationId },
						{ label: 'Status', value: response.retryDeployment.status },
					],
					nextSteps: [inspectCommand(projectId, response.retryDeployment.id)],
					report: { marketId: profile.id, projectId, originalDeployment: redact(response.originalDeployment), retryDeployment: redact(response.retryDeployment), operation: redact(response.operation) },
				});
			}
			if (subaction === 'resume') {
				try {
					const response = await client.resumeProjectDeployment(projectId, deploymentId);
					return guidedResult({
						command: 'projects',
						summary: 'Treeseed project deployment resume queued',
						report: { marketId: profile.id, projectId, response: redact(response) as Record<string, unknown> },
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return guidedResult({
						command: 'projects',
						summary: message,
						exitCode: deploymentApiExitCode(error),
						stderr: [message],
						report: { marketId: profile.id, projectId, deploymentId, ok: false, error: message },
					});
				}
			}
			if (subaction === 'cancel') {
				const response = await client.cancelProjectDeployment(projectId, deploymentId);
				const exitCode = response.deployment.status === 'cancelled' ? 5 : 0;
				return guidedResult({
					command: 'projects',
					summary: response.deployment.status === 'cancelled' ? 'Treeseed project deployment cancelled' : 'Treeseed project deployment cancellation requested',
					exitCode,
					facts: [
						{ label: 'Deployment', value: response.deployment.id },
						{ label: 'Status', value: response.deployment.status },
						{ label: 'Cancellation', value: response.cancellation },
					],
					report: { marketId: profile.id, projectId, deployment: redact(response.deployment), cancellation: response.cancellation },
				});
			}
			const [deploymentResponse, eventsResponse] = await Promise.all([
				client.projectDeployment(projectId, deploymentId),
				client.projectDeploymentEvents(projectId, deploymentId),
			]);
			const deployment = deploymentResponse.payload;
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed project deployment',
				facts: [
					{ label: 'Project', value: projectId },
					{ label: 'Deployment', value: deployment.id },
					{ label: 'Environment', value: deployment.environment },
					{ label: 'Action', value: deployment.action },
					{ label: 'Status', value: deployment.status },
					{ label: 'URL', value: deploymentUrl(deployment) || null },
					{ label: 'Workflow', value: workflowUrl(deployment) || null },
					...monitorFacts(deployment),
				],
				sections: [{
					title: 'Events',
					lines: eventsResponse.payload.map((event) => `${event.sequence}  ${event.kind}  ${event.status ?? ''}  ${event.message}`),
				}, ...monitorSection(deployment)],
				nextSteps: ['failed', 'timed_out', 'cancelled'].includes(deployment.status) ? [retryCommand(projectId, deployment.id)] : [],
				report: { marketId: profile.id, projectId, deployment: redact(deployment), events: redact(eventsResponse.payload) },
			});
		}
		return fail(`Unknown projects action: ${action}`);
	} catch (error) {
		const auth = authFailure(error);
		if (auth) return auth;
		const message = error instanceof Error ? error.message : String(error);
		return guidedResult({
			command: 'projects',
			summary: message,
			exitCode: deploymentApiExitCode(error),
			stderr: [message],
			report: { marketId: profile.id, ok: false, error: message },
		});
	}
};
