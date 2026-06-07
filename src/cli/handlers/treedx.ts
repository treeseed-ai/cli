import type { TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';

function stringArg(invocation: TreeseedParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, key: string) {
	return invocation.args[key] === true;
}

function marketRequest<T>(client: unknown, path: string, options: { method?: string; body?: unknown; requireAuth?: boolean } = {}) {
	return (client as { request<TResponse>(path: string, options?: { method?: string; body?: unknown; requireAuth?: boolean }): Promise<TResponse> })
		.request<T>(path, options);
}

function teamId(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'team');
}

function projectId(invocation: TreeseedParsedInvocation) {
	return stringArg(invocation, 'project');
}

function environmentArg(invocation: TreeseedParsedInvocation) {
	const value = stringArg(invocation, 'environment') ?? 'staging';
	return value === 'prod' ? 'prod' : 'staging';
}

function recordValue(record: unknown, key: string) {
	return record && typeof record === 'object' && key in record ? (record as Record<string, unknown>)[key] : undefined;
}

function jsonResult(invocation: TreeseedParsedInvocation, context: unknown, report: Record<string, unknown>) {
	if ((context as { outputFormat?: string }).outputFormat === 'json' || boolArg(invocation, 'json')) {
		return { exitCode: 0, stdout: [JSON.stringify(report, null, 2)], stderr: [], report };
	}
	return null;
}

async function status(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const team = teamId(invocation);
	if (!team) return fail('Missing --team. Use `trsd db status --team <team-id>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const response = await marketRequest<{ ok: true; payload: Record<string, unknown> }>(
		client,
		`/v1/teams/${encodeURIComponent(team)}/treedx`,
		{ requireAuth: true },
	);
	const payload = response.payload;
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, team, payload });
	if (json) return json;
	const instance = recordValue(payload, 'instance') as Record<string, unknown> | null;
	return guidedResult({
		command: 'db status',
		summary: instance ? 'TreeDX binding is configured.' : 'No TreeDX binding is configured.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: team },
			{ label: 'Instance', value: String(recordValue(instance, 'name') ?? 'none') },
			{ label: 'Status', value: String(recordValue(instance, 'status') ?? 'not configured') },
			{ label: 'Provider', value: String(recordValue(instance, 'provider') ?? 'n/a') },
		],
		sections: [
			{ title: 'Mirrors', lines: ((recordValue(payload, 'mirrors') as unknown[]) ?? []).map((mirror: any) => `${mirror.name}: ${mirror.status} ${mirror.targetUrl ?? mirror.targetKind ?? ''}`) },
			{ title: 'Shares', lines: ((recordValue(payload, 'shares') as unknown[]) ?? []).map((share: any) => `${share.scope}: ${share.status} ${share.libraryId ?? share.projectId ?? ''}`) },
		],
		report: { ok: true, market: profile.id, team, payload },
	});
}

async function provision(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const team = teamId(invocation);
	if (!team) return fail('Missing --team. Use `trsd db provision --team <team-id>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const body = {
		publicRead: boolArg(invocation, 'public'),
		baseUrl: stringArg(invocation, 'url'),
		imageRef: stringArg(invocation, 'image') ?? undefined,
	};
	const response = await marketRequest<{ ok: true; payload: Record<string, unknown> }>(
		client,
		`/v1/teams/${encodeURIComponent(team)}/treedx/provision`,
		{ method: 'POST', body, requireAuth: true },
	);
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, team, payload: response.payload });
	if (json) return json;
	return guidedResult({
		command: 'db provision',
		summary: body.publicRead ? 'Attached the team to the public TreeSeed federation.' : 'Queued a private managed TreeDX binding.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: team },
			{ label: 'Mode', value: body.publicRead ? 'public federation' : 'private managed Railway service' },
		],
		report: { ok: true, market: profile.id, team, payload: response.payload },
	});
}

async function connect(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const team = teamId(invocation);
	const url = stringArg(invocation, 'url');
	if (!team || !url) return fail('Missing --team or --url. Use `trsd db connect --team <team-id> --url <base-url>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const response = await marketRequest<{ ok: true; payload: Record<string, unknown> }>(
		client,
		`/v1/teams/${encodeURIComponent(team)}/treedx`,
		{
			method: 'PUT',
			body: {
				kind: boolArg(invocation, 'selfHosted') ? 'self_hosted' : 'managed_private',
				provider: boolArg(invocation, 'selfHosted') ? 'self_hosted' : 'railway',
				baseUrl: url,
				registryUrl: stringArg(invocation, 'registryUrl') ?? url,
				status: 'active',
				publicRead: boolArg(invocation, 'public'),
			},
			requireAuth: true,
		},
	);
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, team, payload: response.payload });
	if (json) return json;
	return guidedResult({
		command: 'db connect',
		summary: 'Connected a TreeDX primary binding.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: team },
			{ label: 'TreeDX URL', value: url },
		],
		report: { ok: true, market: profile.id, team, payload: response.payload },
	});
}

async function mirrors(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const team = teamId(invocation);
	if (!team) return fail('Missing --team. Use `trsd db mirrors --team <team-id>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const create = stringArg(invocation, 'name') || stringArg(invocation, 'targetUrl');
	const response = await marketRequest<{ ok: true; payload: unknown }>(
		client,
		`/v1/teams/${encodeURIComponent(team)}/treedx/mirrors`,
		create
			? {
				method: 'POST',
				body: {
					name: stringArg(invocation, 'name') ?? 'TreeDX mirror',
					targetUrl: stringArg(invocation, 'targetUrl'),
					targetKind: stringArg(invocation, 'targetKind') ?? 'git',
					direction: stringArg(invocation, 'direction') ?? 'bidirectional',
				},
				requireAuth: true,
			}
			: { requireAuth: true },
	);
	const payload = response.payload;
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, team, payload });
	if (json) return json;
	const lines = Array.isArray(payload)
		? payload.map((mirror: any) => `${mirror.name}: ${mirror.status} ${mirror.targetUrl ?? mirror.targetKind ?? ''}`)
		: [`${(payload as any).name}: ${(payload as any).status}`];
	return guidedResult({
		command: 'db mirrors',
		summary: create ? 'Created TreeDX mirror record.' : 'TreeDX mirrors listed.',
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: team }],
		sections: [{ title: 'Mirrors', lines }],
		report: { ok: true, market: profile.id, team, payload },
	});
}

async function shares(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const team = teamId(invocation);
	if (!team) return fail('Missing --team. Use `trsd db shares --team <team-id>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const create = stringArg(invocation, 'scope') || stringArg(invocation, 'library') || boolArg(invocation, 'public');
	const response = await marketRequest<{ ok: true; payload: unknown }>(
		client,
		`/v1/teams/${encodeURIComponent(team)}/treedx/shares`,
		create
			? {
				method: 'POST',
				body: {
					scope: stringArg(invocation, 'scope') ?? (boolArg(invocation, 'public') ? 'public_federation' : 'team'),
					libraryId: stringArg(invocation, 'library'),
					projectId: projectId(invocation),
					targetTeamId: stringArg(invocation, 'targetTeam'),
					publicRead: boolArg(invocation, 'public'),
				},
				requireAuth: true,
			}
			: { requireAuth: true },
	);
	const payload = response.payload;
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, team, payload });
	if (json) return json;
	const lines = Array.isArray(payload)
		? payload.map((share: any) => `${share.scope}: ${share.status} ${share.libraryId ?? share.projectId ?? ''}`)
		: [`${(payload as any).scope}: ${(payload as any).status}`];
	return guidedResult({
		command: 'db shares',
		summary: create ? 'Created TreeDX share record.' : 'TreeDX shares listed.',
		facts: [{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: team }],
		sections: [{ title: 'Shares', lines }],
		report: { ok: true, market: profile.id, team, payload },
	});
}

async function library(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const project = projectId(invocation);
	if (!project) return fail('Missing --project. Use `trsd db library --project <project-id>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const bind = stringArg(invocation, 'library') || stringArg(invocation, 'instance');
	const response = await marketRequest<{ ok: true; payload: unknown }>(
		client,
		`/v1/projects/${encodeURIComponent(project)}/treedx-library`,
		bind
			? {
				method: 'POST',
				body: {
					instanceId: stringArg(invocation, 'instance'),
					libraryId: stringArg(invocation, 'library'),
					repositoryId: stringArg(invocation, 'repository'),
					contentRepositoryUrl: stringArg(invocation, 'contentRepositoryUrl'),
				},
				requireAuth: true,
			}
			: { requireAuth: true },
	);
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, project, payload: response.payload });
	if (json) return json;
	return guidedResult({
		command: 'db library',
		summary: bind ? 'Project TreeDX library binding saved.' : 'Project TreeDX library binding loaded.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Project', value: project },
			{ label: 'Library', value: String(recordValue(response.payload, 'libraryId') ?? 'not bound') },
		],
		report: { ok: true, market: profile.id, project, payload: response.payload },
	});
}

async function topology(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const project = projectId(invocation);
	if (!project) return fail('Missing --project. Use `trsd db topology --project <project-id>`.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const response = await marketRequest<{ ok: true; payload: Record<string, unknown> }>(
		client,
		`/v1/projects/${encodeURIComponent(project)}/repository-topology`,
		{ requireAuth: true },
	);
	const payload = response.payload;
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, project, payload });
	if (json) return json;
	const content = recordValue(payload, 'contentRepository') as Record<string, unknown>;
	const site = recordValue(payload, 'siteRepository') as Record<string, unknown>;
	const parent = recordValue(payload, 'projectRepository') as Record<string, unknown> | null;
	return guidedResult({
		command: 'db topology',
		summary: 'Project repository topology loaded.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Project', value: project },
		],
		sections: [
			{ title: 'Content', lines: [`${recordValue(content, 'accessMode')} ${JSON.stringify(recordValue(content, 'treeDx') ?? {})}`] },
			{ title: 'Site', lines: [`${recordValue(site, 'accessMode')} ${recordValue(site, 'url') ?? recordValue(site, 'name') ?? ''} -> ${recordValue(site, 'volumePath') ?? recordValue(site, 'checkoutPath') ?? ''}`] },
			{ title: 'Project', lines: parent ? [`${recordValue(parent, 'accessMode')} ${recordValue(parent, 'url') ?? recordValue(parent, 'name') ?? ''} -> ${recordValue(parent, 'volumePath') ?? recordValue(parent, 'checkoutPath') ?? ''}`] : ['No parent project repository configured.'] },
		],
		report: { ok: true, market: profile.id, project, payload },
	});
}

async function publish(invocation: TreeseedParsedInvocation, context: Parameters<TreeseedCommandHandler>[1]) {
	const project = projectId(invocation);
	if (!project) return fail('Missing --project. Use `trsd db publish --project <project-id>`.');
	const environment = environmentArg(invocation);
	if (environment === 'prod' && !boolArg(invocation, 'yes')) return fail('Production content publish requires --yes and was not queued.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	const response = await marketRequest<{ ok: true; payload: Record<string, unknown> }>(
		client,
		`/v1/projects/${encodeURIComponent(project)}/deployments/web`,
		{
			method: 'POST',
			body: {
				environment,
				action: 'publish_content',
				source: 'cli',
				reason: stringArg(invocation, 'reason') ?? 'TreeDX content publish',
				confirmProduction: environment === 'prod',
				dryRun: boolArg(invocation, 'dryRun'),
			},
			requireAuth: true,
		},
	);
	const json = jsonResult(invocation, context, { ok: true, market: profile.id, project, payload: response.payload });
	if (json) return json;
	const deployment = recordValue(response.payload, 'deployment') as Record<string, unknown> | undefined;
	const operation = recordValue(response.payload, 'operation') as Record<string, unknown> | undefined;
	return guidedResult({
		command: 'db publish',
		summary: 'TreeDX content publish queued.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Project', value: project },
			{ label: 'Environment', value: environment },
			{ label: 'Deployment', value: String(recordValue(deployment, 'id') ?? 'queued') },
			{ label: 'Operation', value: String(recordValue(operation, 'id') ?? 'queued') },
		],
		report: { ok: true, market: profile.id, project, payload: response.payload },
	});
}

export const handleTreeDx: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	try {
		if (action === 'status') return status(invocation, context);
		if (action === 'provision') return provision(invocation, context);
		if (action === 'connect') return connect(invocation, context);
		if (action === 'mirrors') return mirrors(invocation, context);
		if (action === 'shares') return shares(invocation, context);
		if (action === 'library') return library(invocation, context);
		if (action === 'topology') return topology(invocation, context);
		if (action === 'publish') return publish(invocation, context);
		return fail('Unknown db action. Use status, provision, connect, mirrors, shares, library, topology, or publish.');
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
};
