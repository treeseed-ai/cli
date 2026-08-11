import { resolve } from 'node:path';
import { applyContentSync, planContentSync, type ContentSyncPlan } from '@treeseed/sdk';
import { MarketClientError } from '@treeseed/sdk/market-client';
import type { CommandHandler, ParsedInvocation } from '../../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from '../utilities/utils.js';
import { handleContentPublish } from './publish.js';

function textArg(invocation: ParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nested(record: unknown, path: string[]): unknown {
	let value = record;
	for (const key of path) {
		if (!value || typeof value !== 'object') return null;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}

function firstText(record: unknown, paths: string[][]) {
	for (const path of paths) {
		const value = nested(record, path);
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

function request<T>(client: unknown, path: string, options: { method?: string; body?: unknown; requireAuth?: boolean } = {}) {
	return (client as { request<R>(path: string, options?: typeof options): Promise<R> }).request<T>(path, options);
}

function reportResult(plan: ContentSyncPlan, applied: boolean, market: string, projectId: string) {
	return {
		ok: plan.status !== 'blocked', applied, market, projectId,
		status: plan.status, branch: plan.branch, repositoryRoot: plan.repositoryRoot,
		localHead: plan.localHead, upstreamHead: plan.upstreamHead, treeDxHead: plan.treeDxHead,
		providerHead: plan.providerHead, publishedHead: plan.publishedHead, publicationRevision: plan.publicationRevision,
		dirtyPaths: plan.dirtyPaths, blockers: plan.blockers,
	};
}

export const handleContent: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'sync';
	if (action === 'publish') return handleContentPublish(invocation, context);
	if (action !== 'sync') return fail(`Unknown content action: ${action}. Use content sync or content publish.`);
	const projectId = textArg(invocation, 'project');
	if (!projectId) return fail('Content sync requires --project <project-id>.');
	const branch = textArg(invocation, 'branch') ?? 'staging';
	const repositoryRoot = resolve(context.cwd, textArg(invocation, 'path') ?? '.');
	const shouldPlan = invocation.args.plan === true;
	const { profile, client } = createMarketClientForInvocation(invocation, context, {
		requireAuth: true,
		allowLocalAcceptanceAdmin: true,
	});
	const topologyResponse = await request<{ payload: Record<string, unknown> }>(
		client, `/v1/projects/${encodeURIComponent(projectId)}/repository-topology`, { requireAuth: true },
	);
	const providerResponse = await request<{ payload: { cloneUrl?: string; observedHead?: string } }>(
		client, `/v1/projects/${encodeURIComponent(projectId)}/repository-topology/status`, { requireAuth: true },
	);
	const projectResponse = await request<{ payload: Record<string, unknown> }>(
		client, `/v1/projects/${encodeURIComponent(projectId)}`, { requireAuth: true },
	);
	const teamId = firstText(projectResponse.payload, [['teamId'], ['team', 'id'], ['project', 'teamId']]);
	if (!teamId) return fail('The project does not resolve an owning team.');
	const repositoryId = firstText(topologyResponse.payload, [
		['contentRepository', 'treeDx', 'repositoryId'], ['contentRepository', 'repositoryId'],
	]);
	if (!repositoryId) return fail('The project does not have a TreeDX content repository binding.');
	let observed: { payload?: unknown } | null = null;
	try {
		observed = await request<{ payload?: unknown }>(
			client, `/v1/dx/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repositoryId)}/paths/list`,
			{ method: 'POST', body: { ref: branch, paths: ['**'], limit: 1 }, requireAuth: true },
		);
	} catch (error) {
		if (!shouldPlan || !(error instanceof MarketClientError)) throw error;
	}
	const treeDxHead = firstText(observed, [
		['payload', 'resolvedRef'], ['payload', 'commitSha'], ['payload', 'source', 'commitSha'],
		['resolvedRef'], ['commitSha'],
	]);
	const publicationResponse = await request<{ payload?: { manifest?: { revision?: string; projects?: Array<{ projectId?: string; commitSha?: string }> } } }>(
		client, `/v1/teams/${encodeURIComponent(teamId)}/knowledge/publication-status`, { requireAuth: true },
	);
	const publication = publicationResponse.payload?.manifest;
	const publishedHead = publication?.projects?.find((project) => project.projectId === projectId)?.commitSha ?? null;
	const plan = planContentSync({ repositoryRoot, branch, treeDxHead, publishedHead,
		publicationRevision: publication?.revision ?? null, canonicalRemoteUrl: providerResponse.payload.cloneUrl ?? null,
		providerHead: providerResponse.payload.observedHead ?? null, env: context.env });
	const canApply = plan.status === 'fast-forward' || plan.status === 'verification-required';
	const finalPlan = !shouldPlan && canApply ? applyContentSync(plan, context.env) : plan;
	const applied = !shouldPlan && canApply;
	const report = reportResult(finalPlan, applied, profile.id, projectId);
	if (context.outputFormat === 'json' || invocation.args.json === true) {
		return { exitCode: finalPlan.status === 'blocked' ? 1 : 0, stdout: [JSON.stringify(report, null, 2)], report };
	}
	return guidedResult({
		command: 'content sync',
		summary: finalPlan.status === 'blocked'
			? 'Content synchronization is blocked.'
			: applied ? 'Content checkout fast-forwarded safely.' : `Content synchronization ${finalPlan.status}.`,
		facts: [
			{ label: 'Project', value: projectId }, { label: 'Branch', value: branch },
			{ label: 'Local', value: finalPlan.localHead }, { label: 'Upstream', value: finalPlan.upstreamHead ?? 'unavailable' },
			{ label: 'TreeDX', value: finalPlan.treeDxHead ?? 'unavailable' },
			{ label: 'Provider', value: finalPlan.providerHead ?? 'unavailable' },
			{ label: 'Published', value: finalPlan.publishedHead ?? 'unavailable' },
			{ label: 'Publication', value: finalPlan.publicationRevision ?? 'unavailable' },
		],
		sections: finalPlan.blockers.length ? [{ title: 'Blockers', lines: finalPlan.blockers }] : [],
		report,
		exitCode: finalPlan.status === 'blocked' ? 1 : 0,
	});
};
