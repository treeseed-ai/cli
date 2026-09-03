import type { InkRow as Row, InkSurfaceCollection as SurfaceCollection, InkSurfaceItem as SurfaceItem, InkWorkspaceDataSource } from '@treeseed/ui/ink';
import { validateCapacityAllocationSetV2, type CapacityAllocationSetV2 } from '@treeseed/sdk/agent-capacity';
import { parse as parseYaml } from 'yaml';

export type { InkRow as Row, InkSurfaceCollection as SurfaceCollection, InkSurfaceItem as SurfaceItem } from '@treeseed/ui/ink';
export type Invoke = (operationId: string, input: { path: Row; query: Row; body: unknown }, options?: Row) => Promise<unknown>;

function record(value: unknown): Row {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function payload(value: unknown) {
	const outer = record(value);
	return record(outer.data ?? outer.payload ?? outer);
}

function rows(value: unknown) {
	const data = payload(value);
	for (const candidate of [data.items, data.projects, data.agents, data.providers, data.reviews, data.pages, data.books, data.topics, data.results, data.events]) if (Array.isArray(candidate)) return candidate.map(record);
	return [];
}

function text(value: unknown) { return typeof value === 'string' ? value : value == null ? '' : String(value); }

function item(value: Row, index: number): SurfaceItem {
	const raw = {
		...value,
		name: value.name ?? value.displayName ?? value.providerName ?? value.providerId ?? value.version ?? value.path,
		provider: value.provider ?? value.providerId,
		objective: value.objective ?? value.coreObjective,
	};
	return {
		id: text(value.id ?? value.reviewId ?? value.slug ?? value.channel ?? value.key) || `item-${index}`,
		title: text(value.title ?? value.displayName ?? value.name ?? value.label ?? value.version ?? value.path ?? value.providerName ?? value.providerId ?? value.slug ?? value.channel) || `Item ${index + 1}`,
		description: text(value.description ?? value.summary ?? value.objective ?? value.message ?? value.content),
		status: text(value.status ?? value.state) || undefined,
		raw,
	};
}

export async function loadWorkspaceItems(invoke: Invoke, teamId: string, workspace: 'team' | 'chat' | 'inbox' | 'discover', query = '') {
	let response: unknown;
	if (workspace === 'team') response = await invoke('projects.list', { path: {}, query: { teamId }, body: undefined });
	else if (workspace === 'chat') response = await invoke('communications.topics.list', { path: { teamId }, query: { limit: 100 }, body: undefined });
	else if (workspace === 'inbox') response = await invoke('inbox.items.list', { path: { teamId }, query: { limit: 100, kind: 'all', state: 'all' }, body: undefined });
	else if (query.trim()) response = await invoke('knowledge.team.search', { path: { teamId }, query: {}, body: { query, limit: 100 } });
	else return [];
	return rows(response).map(item);
}

const collectionBindings = {
	services: { operationId: 'services.connections.list', input: (teamId: string) => ({ path: { teamId }, query: { limit: 100 }, body: undefined }) },
	capacity: { operationId: 'providers.list', input: (teamId: string) => ({ path: { teamId }, query: { limit: 100 }, body: undefined }) },
	projects: { operationId: 'projects.list', input: (teamId: string) => ({ path: {}, query: { teamId, limit: 100 }, body: undefined }) },
	knowledge: { operationId: 'knowledge.catalog.team', input: (teamId: string) => ({ path: { teamId }, query: { limit: 100 }, body: undefined }) },
} as const;

export type BoundCollectionSurface = keyof typeof collectionBindings | 'model' | 'template' | 'content';

export async function loadSurfaceCollection(invoke: Invoke, teamId: string, surface: string): Promise<SurfaceCollection> {
	if (surface === 'agent-builder') {
		const projects = rows(await invoke('projects.list', { path: {}, query: { teamId, limit: 100 }, body: undefined }));
		const agents = (await Promise.all(projects.map(async (project) => {
			const projectId = text(project.id);
			if (!projectId) return [];
			return rows(await invoke('agents.list', { path: { projectId }, query: { limit: 100 }, body: undefined })).map((agent) => ({ ...agent, projectId, projectName: project.name ?? project.displayName }));
		}))).flat().map(item);
		return { items: agents, message: agents.length ? `${agents.length} live agent${agents.length === 1 ? '' : 's'} across ${projects.length} projects.` : `No agents are visible across ${projects.length} active-team project${projects.length === 1 ? '' : 's'}.` };
	}
	if (surface === 'allocator') {
		const items = rows(await invoke('providers.list', { path: { teamId }, query: { limit: 100 }, body: undefined })).map(item);
		return { items, message: items.length ? `${items.length} live capacity allocation input${items.length === 1 ? '' : 's'}.` : 'No capacity allocation inputs are visible in the active team.' };
	}
	if (surface === 'releases') {
		const items = rows(await invoke('knowledge.reviews.list', { path: { teamId }, query: { limit: 100 }, body: undefined })).map(item);
		return { items, message: items.length ? `${items.length} live staging or production release record${items.length === 1 ? '' : 's'}.` : 'No release records are visible in the active team.' };
	}
	const catalogSurface = ['model', 'template', 'content'].includes(surface) ? 'knowledge' : surface;
	const binding = collectionBindings[catalogSurface as keyof typeof collectionBindings];
	if (!binding) return { items: [], message: 'This surface needs additional context before its live collection can be loaded.' };
	const response = await invoke(binding.operationId, binding.input(teamId));
	let items = rows(response).map(item);
	if (surface === 'model' || surface === 'template') {
		items = items.filter((entry) => text(entry.raw.kind ?? entry.raw.type ?? entry.raw.contentType).toLowerCase().includes(surface));
	}
	return { items, message: items.length ? `${items.length} live ${surface} item${items.length === 1 ? '' : 's'}.` : `No ${surface} items are visible in the active team.` };
}

export function canExecuteSurfaceAction(actionId: string, selected?: SurfaceItem) {
	if (['project.create', 'service.connect', 'capacity.configure', 'allocation.save', 'agent.create'].includes(actionId)) return true;
	if (['service.configure', 'service.remove', 'capacity.revoke', 'agent.save', 'content.edit', 'release.promote-production'].includes(actionId)) return Boolean(selected);
	if (actionId === 'release.cut') return !selected || ['approved', 'ready', 'staging'].includes(text(selected.raw.status));
	if (actionId === 'question.answer') return selected?.raw.kind === 'question' && selected.raw.status === 'outstanding';
	if (actionId === 'proposal.approve' || actionId === 'proposal.reject') return selected?.raw.kind === 'proposal' && selected.raw.status === 'outstanding';
	return false;
}

export async function executeSurfaceAction(invoke: Invoke, teamId: string, actionId: string, values: Row, selected?: SurfaceItem) {
	if (actionId === 'project.create') return invoke('projects.create', { path: { teamId }, query: {}, body: {
		name: text(values.name).trim(),
		slug: text(values.slug).trim(),
		description: text(values.description).trim() || undefined,
	} }, { idempotencyKey: globalThis.crypto.randomUUID() });
	const inboxAction = actionId === 'question.answer' ? 'answer' : actionId === 'proposal.approve' ? 'approve' : actionId === 'proposal.reject' ? 'reject' : undefined;
	if (inboxAction) {
		if (!selected) throw new Error(`${actionId} requires a selected inbox item.`);
		const etag = text(selected.raw.etag);
		if (!etag) throw new Error(`${actionId} requires the selected item's concurrency version.`);
		return invoke('inbox.items.action', { path: { teamId, itemId: selected.id }, query: {}, body: {
			action: inboxAction,
			...(text(values.markdown).trim() ? { markdown: text(values.markdown).trim() } : {}),
		} }, { idempotencyKey: globalThis.crypto.randomUUID(), headers: { 'If-Match': etag } });
	}
	const etag = text(selected?.raw.etag ?? selected?.raw.version);
	const concurrency = etag ? { headers: { 'If-Match': etag } } : {};
	if (actionId === 'service.connect') return invoke('services.connections.create', { path: { teamId }, query: {}, body: {
		providerId: text(values.providerId), displayName: text(values.displayName),
		...(text(values.capabilities) ? { capabilities: JSON.parse(text(values.capabilities)) } : {}),
	} }, { idempotencyKey: globalThis.crypto.randomUUID() });
	if (actionId === 'service.configure') {
		if (!selected) throw new Error('Configure service requires a selected connection.');
		return invoke('services.connections.update', { path: { teamId, connectionId: selected.id }, query: {}, body: {
			displayName: text(values.displayName), ...(text(values.capabilities) ? { capabilities: JSON.parse(text(values.capabilities)) } : {}),
		} }, concurrency);
	}
	if (actionId === 'service.remove') {
		if (!selected) throw new Error('Remove service requires a selected connection.');
		return invoke('services.connections.disconnect', { path: { teamId, connectionId: selected.id }, query: {}, body: undefined }, concurrency);
	}
	if (actionId === 'capacity.configure') return invoke('providers.connect', { path: { teamId }, query: {}, body: undefined }, { idempotencyKey: globalThis.crypto.randomUUID(), uiConfirmed: true });
	if (actionId === 'capacity.revoke') {
		if (!selected) throw new Error('Revoke capacity requires a selected provider connection.');
		return invoke('providers.disconnect', { path: { teamId, connectionId: text(selected.raw.connectionId) || selected.id }, query: {}, body: undefined }, { idempotencyKey: globalThis.crypto.randomUUID() });
	}
	if (['content.edit', 'agent.create', 'agent.save', 'allocation.save'].includes(actionId)) return executeTreeDxAuthoring(invoke, actionId, values, selected);
	if (actionId === 'release.cut' || actionId === 'release.promote-production') {
		const reviewId = text(values.reviewId) || selected?.id;
		if (!reviewId) throw new Error(`${actionId} requires a review.`);
		return invoke('knowledge.reviews.publish', { path: { reviewId }, query: {}, body: {
			targetEnvironment: actionId === 'release.cut' ? 'staging' : 'production', ...(text(values.notes) ? { notes: text(values.notes) } : {}),
		} }, { ...concurrency, idempotencyKey: globalThis.crypto.randomUUID() });
	}
	throw new Error(`Action ${actionId} is not implemented in the Ink renderer.`);
}

async function executeTreeDxAuthoring(invoke: Invoke, actionId: string, values: Row, selected?: SurfaceItem) {
	const projectId = text(values.projectId || selected?.raw.projectId);
	if (!projectId) throw new Error(`${actionId} requires a project ID.`);
	if (actionId === 'allocation.save') {
		let allocation: unknown;
		try { allocation = parseYaml(text(values.content)); }
		catch (error) { throw new Error(`Allocation profile is not valid JSON or YAML: ${error instanceof Error ? error.message : String(error)}`); }
		const validation = validateCapacityAllocationSetV2(allocation as CapacityAllocationSetV2);
		if (!validation.ok) throw new Error(`Allocation profile is invalid: ${validation.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join(' ')}`);
	}
	let workspaceId = text(values.workspaceId), version = Number(values.version || 0);
	if (!workspaceId) {
		const created = payload(await invoke('knowledge.workspaces.create', { path: { projectId }, query: {}, body: { requestId: globalThis.crypto.randomUUID() } }, { idempotencyKey: globalThis.crypto.randomUUID() }));
		workspaceId = text(created.id ?? created.workspaceId); version = Number(created.version ?? 1);
	}
	if (!workspaceId || version < 1) throw new Error('A valid TreeDX workspace and version are required.');
	const sourcePath = text(values.sourcePath || selected?.raw.path);
	const body = actionId === 'content.edit' ? { kind: 'page', version, sourcePath: sourcePath || undefined, bookId: text(values.bookId), slug: text(values.slug), title: text(values.title), summary: text(values.summary), body: text(values.body) }
		: { kind: actionId === 'agent.save' || actionId === 'agent.create' ? 'agent-profile' : 'operational-content', version, sourcePath, expectedSha: text(selected?.raw.sha ?? values.expectedSha) || undefined, content: text(values.content), ...(actionId === 'agent.create' || !sourcePath ? { create: true } : {}) };
	const updated = payload(await invoke('knowledge.workspaces.content.update', { path: { workspaceId }, query: {}, body }, {}));
	const nextWorkspace = record(updated.workspace), nextVersion = Number(nextWorkspace.version ?? version + 1);
	return invoke('knowledge.workspaces.submit', { path: { workspaceId }, query: {}, body: { version: nextVersion, message: text(values.message) } }, { idempotencyKey: globalThis.crypto.randomUUID() });
}

export async function sendWorkspaceMessage(invoke: Invoke, teamId: string, channel: string, message: string) {
	return invoke('communications.send', { path: { teamId, channel }, query: {}, body: { message } }, {});
}

export function createInkWorkspaceDataSource(invoke: Invoke, teamId: string): InkWorkspaceDataSource {
	return {
		loadWorkspace: (workspace, query) => loadWorkspaceItems(invoke, teamId, workspace, query),
		loadSurface: (surface) => loadSurfaceCollection(invoke, teamId, surface),
		canExecute: canExecuteSurfaceAction,
		execute: (actionId, values, selected) => executeSurfaceAction(invoke, teamId, actionId, values, selected),
		sendMessage: (channel, message) => sendWorkspaceMessage(invoke, teamId, channel, message),
	};
}
