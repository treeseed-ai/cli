import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { MarketClient } from '@treeseed/sdk/market-client';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityStringArg as text } from '../capacity-core/capacity-command-arguments.js';

export const CAPACITY_AGENT_CLASS_ACTIONS = new Set([
	'agent-classes',
	'agent-class',
	'agent-classes-sync',
]);

async function desiredClasses(invocation: ParsedInvocation, context: CommandContext) {
	const file = text(invocation, 'file');
	const document = text(invocation, 'document');
	if (!file && !document) throw new Error('agent-classes-sync requires --file <classes.yaml> or --document \'<yaml-or-json>\'.');
	const parsed = parseYaml(document ?? await readFile(resolve(context.cwd, file!), 'utf8')) as unknown;
	const entries = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).agentClasses)
			? (parsed as Record<string, unknown>).agentClasses as unknown[]
			: null;
	if (!entries?.length || entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
		throw new Error('Agent-class configuration must contain a non-empty agentClasses object array.');
	}
	return entries as Array<Record<string, unknown>>;
}

async function allClasses(client: MarketClient, projectId: string) {
	const items: Array<Record<string, unknown>> = [];
	let cursor: string | null = null;
	do {
		const response = await client.projectAgentClasses(projectId, { limit: 200, cursor });
		items.push(...response.payload.items);
		cursor = response.payload.page.nextCursor;
	} while (cursor);
	return items;
}

export async function runCapacityAgentClassAction(
	action: string,
	invocation: ParsedInvocation,
	context: CommandContext,
) {
	const projectId = text(invocation, 'project');
	if (!projectId) return fail(`Missing --project for capacity ${action}.`);
	const { profile, client } = createMarketClientForInvocation(invocation, context, {
		requireAuth: true,
		allowLocalAcceptanceAdmin: true,
	});
	let payload: unknown;
	if (action === 'agent-classes') {
		payload = await client.projectAgentClasses(projectId, {
			limit: text(invocation, 'limit') ? Number(text(invocation, 'limit')) : undefined,
			cursor: text(invocation, 'cursor'),
		});
	} else if (action === 'agent-class') {
		const classId = text(invocation, 'agentClass');
		if (!classId) return fail('Missing --agent-class for capacity agent-class.');
		payload = await client.projectAgentClass(projectId, classId);
	} else {
		const plan = invocation.args.plan === true;
		const execute = invocation.args.execute === true;
		if (plan === execute) return fail('Capacity agent-classes-sync is mutating. Choose exactly one of --plan or --execute.');
		const desired = await desiredClasses(invocation, context);
		const existing = await allClasses(client, projectId);
		const byIdentity = new Map(existing.flatMap((entry) => [
			[String(entry.id ?? ''), entry] as const,
			[String(entry.slug ?? ''), entry] as const,
		]).filter(([identity]) => identity));
		const changes = desired.map((entry) => {
			const current = byIdentity.get(String(entry.id ?? '')) ?? byIdentity.get(String(entry.slug ?? ''));
			return { action: current ? 'update' as const : 'create' as const, current, desired: entry };
		});
		if (plan) payload = { mode: 'plan', changes };
		else {
			const results = [];
			const operationKey = text(invocation, 'idempotencyKey') ?? `cli:agent-classes-sync:${randomUUID()}`;
			for (const change of changes) {
				const identity = String(change.desired.id ?? change.desired.slug ?? change.current?.id ?? 'agent-class');
				const key = `${operationKey}:${change.action}:${identity}`;
				results.push(change.action === 'create'
					? await client.createProjectAgentClass(projectId, change.desired, key)
					: await client.updateProjectAgentClass(projectId, String(change.current!.id), change.desired, key));
			}
			payload = { mode: 'live', changes: results };
		}
	}
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Capacity ${action} completed for project ${projectId}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Project', value: projectId },
		],
		report: { action, projectId, payload },
	});
}
