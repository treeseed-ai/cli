import { MarketClientError } from '@treeseed/sdk/market-client';
import {
	githubRepositoryCredentialEnvName,
	parseProjectLaunchHostBindingSpecs,
	planRepositoryImport,
} from '@treeseed/sdk';
import type { ProjectDeploymentEnvironment, ProjectWebDeploymentAction } from '@treeseed/sdk';
import type { CommandContext, CommandHandler, ParsedInvocation } from '../../../types.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';

export const DEPLOYMENT_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
export const FORBIDDEN_OUTPUT_FIELDS = new Set([
	'capacityProviderId',
	'grantId',
	'workerPoolId',
	'runtimeHostId',
	'railwayServiceId',
	'runnerToken',
]);

export const ACTIONS: Record<string, ProjectWebDeploymentAction> = {
	deploy: 'deploy_web',
	publish: 'publish_content',
	monitor: 'monitor',
};

export function stringArg(invocation: ParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function boolArg(invocation: ParsedInvocation, key: string) {
	return invocation.args[key] === true;
}

export function environmentArg(invocation: ParsedInvocation): ProjectDeploymentEnvironment {
	const value = stringArg(invocation, 'environment') ?? 'staging';
	return value === 'prod' ? 'prod' : 'staging';
}

export function projectUsage(action: string) {
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

export function authFailure(error: unknown) {
	if (error instanceof MarketClientError && [401, 403].includes(error.status)) {
		return fail(error.message, 2);
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/not logged in|unauthori[sz]ed|forbidden/iu.test(message)) {
		return fail(message, 2);
	}
	return null;
}

export function deploymentApiExitCode(error: unknown) {
	if (error instanceof MarketClientError) {
		if ([401, 403].includes(error.status)) return 2;
		const payload = error.payload as any;
		const code = payload?.error?.code ?? payload?.code;
		if (code === 'operation_not_retryable' || code === 'operation_not_cancellable') return 1;
	}
	return 1;
}

export function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => redact(item));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([key]) => !FORBIDDEN_OUTPUT_FIELDS.has(key))
		.filter(([key]) => !/(?:secret|token|password|apiKey|privateKey)/iu.test(key))
		.map(([key, entry]) => [key, redact(entry)]));
}

export function text(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function actionLabel(action: unknown) {
	switch (action) {
		case 'deploy_web': return 'deploy_web';
		case 'publish_content': return 'publish_content';
		case 'monitor': return 'monitor';
		default: return text(action, 'deployment');
	}
}

export function deploymentUrl(deployment: any) {
	return text(deployment?.target?.url, text(deployment?.target?.previewUrl, ''));
}

export function workflowUrl(deployment: any) {
	return text(deployment?.externalWorkflow?.url, text(deployment?.externalWorkflow?.htmlUrl, text(deployment?.externalWorkflow?.runUrl, '')));
}

export function inspectCommand(projectId: string, deploymentId: string) {
	return `trsd projects deployment ${projectId} ${deploymentId}`;
}

export function retryCommand(projectId: string, deploymentId: string) {
	return `trsd projects deployment retry ${projectId} ${deploymentId}`;
}

export function deploymentLine(deployment: any) {
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

export function architectureSummary(project: any) {
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

export function normalizeRepeatable(value: unknown) {
	if (Array.isArray(value)) return value.map(String).filter((entry) => entry.trim());
	return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

export function hostBindingLine(entry: any) {
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

export function operationFacts(projectId: string, response: any) {
	const operation = response.operation ?? null;
	return [
		{ label: 'Project', value: projectId },
		{ label: 'Operation', value: operation?.id ?? null },
		{ label: 'Status', value: operation?.status ?? null },
		{ label: 'Poll', value: operation?.pollUrl ?? null },
	].filter((fact) => fact.value != null && fact.value !== '');
}

export function hostBindingForMarket(parsed: ReturnType<typeof parseProjectLaunchHostBindingSpecs>, requirementKey: string) {
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

export function waitExitCode(status: string) {
	if (status === 'succeeded') return 0;
	if (status === 'timed_out') return 4;
	if (status === 'cancelled') return 5;
	return 3;
}

export function monitorExitCode(deployment: any, fallback: number) {
	if (deployment?.monitor?.status === 'failed') return 3;
	if (['healthy', 'degraded', 'unknown'].includes(String(deployment?.monitor?.status))) return 0;
	return fallback;
}

export function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDeployment(input: {
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

export function timeoutSeconds(invocation: ParsedInvocation) {
	const value = Number(stringArg(invocation, 'timeoutSeconds') ?? 300);
	return Number.isFinite(value) && value > 0 ? value : 300;
}

export function pollIntervalMs(invocation: ParsedInvocation) {
	const value = Number(stringArg(invocation, 'pollIntervalMs') ?? 1000);
	return Number.isFinite(value) && value > 0 ? value : 1000;
}

export function normalizeGitHubRepositorySlug(repository: string) {
	return repository.trim()
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
}

export async function observeGitHubRepository(repository: string, env: Record<string, string | undefined>) {
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

export async function handleProjectImport(invocation: ParsedInvocation, context: CommandContext) {
	const repository = invocation.positionals[1];
	const team = stringArg(invocation, 'team');
	if (!repository || !team) return fail(projectUsage('import'));
	const observation = await observeGitHubRepository(repository, process.env);
	const plan = planRepositoryImport({
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

export function deploymentRequestBody(invocation: ParsedInvocation, action: ProjectWebDeploymentAction, environment: ProjectDeploymentEnvironment) {
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

export function monitorFacts(deployment: any) {
	const monitor = deployment?.monitor && typeof deployment.monitor === 'object' ? deployment.monitor : null;
	if (!monitor) return [];
	return [
		{ label: 'Monitor', value: monitor.status ?? null },
		{ label: 'Checked', value: monitor.checkedAt ?? null },
		{ label: 'Checks', value: Array.isArray(monitor.checks) ? `${monitor.checks.filter((check: any) => check.status === 'passed').length} passed, ${monitor.checks.filter((check: any) => check.status === 'warning').length} warnings, ${monitor.checks.filter((check: any) => check.status === 'failed').length} failed` : null },
	];
}

export function monitorSection(deployment: any) {
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
