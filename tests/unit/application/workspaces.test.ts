import assert from 'node:assert/strict';
import test from 'node:test';
import { canExecuteSurfaceAction, executeSurfaceAction, loadSurfaceCollection, loadWorkspaceItems } from '../../../src/cli/application/data.ts';
import { semanticDocument, semanticRegionDocument, workspaceShortcut } from '@treeseed/ui/ink';
import { renderHelp } from '../../../src/cli/help.ts';

test('workspace loaders bind roots to stable control-plane operations', async () => {
	const calls: string[] = [];
	const inputs: Array<Record<string, unknown>> = [];
	const invoke = async (operationId: string, input: Record<string, unknown>) => {
		calls.push(operationId);
		inputs.push(input);
		return { data: { items: [{ id: `${operationId}-1`, title: operationId, status: 'ready' }] } };
	};
	for (const root of ['team', 'chat', 'inbox'] as const) {
		const items = await loadWorkspaceItems(invoke, 'team-a', root);
		assert.equal(items[0]?.status, 'ready');
	}
	await loadWorkspaceItems(invoke, 'team-a', 'discover', 'capacity');
	assert.deepEqual(calls, ['projects.list', 'communications.topics.list', 'inbox.items.list', 'knowledge.team.search']);
	assert.deepEqual(inputs[2]?.query, { limit: 100, kind: 'all', state: 'all' });
});

test('empty discover state does not issue an unbounded query', async () => {
	let called = false;
	const items = await loadWorkspaceItems(async () => { called = true; return {}; }, 'team-a', 'discover');
	assert.deepEqual(items, []);
	assert.equal(called, false);
});

test('semantic collection surfaces bind pages 6 through 11 to live operations', async () => {
	const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
	const invoke = async (operationId: string, input: Record<string, unknown>) => {
		calls.push({ operationId, input });
		return { data: { items: [
			{ id: 'one', name: 'One', status: 'ready', kind: 'book' },
			{ id: 'model-one', name: 'Model one', kind: 'model' },
		] } };
	};
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'services')).items.length, 2);
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'capacity')).items.length, 2);
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'projects')).items.length, 2);
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'knowledge')).items.length, 2);
	assert.deepEqual((await loadSurfaceCollection(invoke, 'team-a', 'model')).items.map((item) => item.id), ['model-one']);
	assert.deepEqual(calls.map((call) => call.operationId), ['services.connections.list', 'providers.list', 'projects.list', 'knowledge.catalog.team', 'knowledge.catalog.team']);
	assert.deepEqual((calls[0]?.input.path as Record<string, unknown>).teamId, 'team-a');
});

test('remaining semantic surfaces load live agent, allocation, content, and release projections', async () => {
	const calls: string[] = [];
	const invoke = async (operationId: string) => {
		calls.push(operationId);
		if (operationId === 'projects.list') return { data: { items: [{ id: 'project-a', name: 'Project A' }] } };
		if (operationId === 'agents.list') return { data: { agents: [{ id: 'agent-a', name: 'Agent A' }] } };
		return { data: { items: [{ id: `${operationId}-one`, name: operationId }] } };
	};
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'agent-builder')).items[0]?.raw.projectId, 'project-a');
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'allocator')).items.length, 1);
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'content')).items.length, 1);
	assert.equal((await loadSurfaceCollection(invoke, 'team-a', 'releases')).items.length, 1);
	assert.deepEqual(calls, ['projects.list', 'agents.list', 'providers.list', 'knowledge.catalog.team', 'knowledge.reviews.list']);
});

test('semantic resource documents use shared field labels', () => {
	const document = semanticDocument({ id: 'project-a', title: 'Project A', description: 'Objective', status: 'active', raw: { name: 'Project A', objective: 'Ship the interface', status: 'active' } }, [
		{ id: 'name', label: 'Name', type: 'string' },
		{ id: 'objective', label: 'Core objective', type: 'markdown' },
	]);
	assert.match(document, /# Project A/u);
	assert.match(document, /\*\*Core objective\*\*: Ship the interface/u);
});

test('semantic regions render signals, relationships, activity, and scoped forms', () => {
	const selected = { id: 'one', title: 'One', description: '', raw: { health: 'ready', releases: [{ id: 'r1', title: 'Release 1' }], activity: [{ message: 'Updated' }], name: 'One', description: 'Details' } };
	const resource = { id: 'example', label: 'Example', pluralLabel: 'Examples', identityField: 'name', fields: [{ id: 'name', label: 'Name', type: 'string' as const }, { id: 'description', label: 'Description', type: 'markdown' as const }], signals: [{ id: 'health', label: 'Health', type: 'health' as const }], relationships: [{ id: 'releases', label: 'Releases', resource: 'release', cardinality: 'many' as const }] };
	assert.match(semanticRegionDocument(selected, { id: 'signals', type: 'signals' }, resource), /Health\*\*: ready/u);
	assert.match(semanticRegionDocument(selected, { id: 'releases', type: 'relationships', relationship: 'releases' }, resource), /Release 1/u);
	assert.match(semanticRegionDocument(selected, { id: 'activity', type: 'activity' }, resource), /Updated/u);
	assert.doesNotMatch(semanticRegionDocument(selected, { id: 'identity', type: 'form', fields: ['name'] }, resource), /Description/u);
});

test('operable semantic actions bind validated project input to the control plane', async () => {
	let call: { operationId: string; input: Record<string, unknown>; options?: Record<string, unknown> } | undefined;
	const result = await executeSurfaceAction(async (operationId, input, options) => { call = { operationId, input, options }; return { data: { id: 'project-a' } }; }, 'team-a', 'project.create', { name: 'Project A', slug: 'project-a', description: 'Local UI work' });
	assert.deepEqual(result, { data: { id: 'project-a' } });
	assert.equal(canExecuteSurfaceAction('project.create'), true);
	assert.equal(canExecuteSurfaceAction('project.launch'), false);
	assert.equal(call?.operationId, 'projects.create');
	assert.deepEqual(call?.input, { path: { teamId: 'team-a' }, query: {}, body: { name: 'Project A', slug: 'project-a', description: 'Local UI work' } });
	assert.equal(typeof call?.options?.idempotencyKey, 'string');
});

test('inbox semantic actions preserve item kind and optimistic concurrency', async () => {
	const calls: Array<{ operationId: string; input: Record<string, unknown>; options?: Record<string, unknown> }> = [];
	const invoke = async (operationId: string, input: Record<string, unknown>, options?: Record<string, unknown>) => { calls.push({ operationId, input, options }); return { data: { ok: true } }; };
	const question = { id: 'question-a', title: 'Question A', description: '', status: 'outstanding', raw: { kind: 'question', status: 'outstanding', etag: 'question-v3' } };
	const proposal = { id: 'proposal-a', title: 'Proposal A', description: '', status: 'outstanding', raw: { kind: 'proposal', status: 'outstanding', etag: 'proposal-v5' } };
	assert.equal(canExecuteSurfaceAction('question.answer', question), true);
	assert.equal(canExecuteSurfaceAction('proposal.approve', question), false);
	assert.equal(canExecuteSurfaceAction('proposal.approve', proposal), true);
	await executeSurfaceAction(invoke, 'team-a', 'question.answer', { markdown: 'Use the shared registry.' }, question);
	await executeSurfaceAction(invoke, 'team-a', 'proposal.reject', { markdown: 'Needs revision.' }, proposal);
	assert.deepEqual(calls.map((call) => call.input), [
		{ path: { teamId: 'team-a', itemId: 'question-a' }, query: {}, body: { action: 'answer', markdown: 'Use the shared registry.' } },
		{ path: { teamId: 'team-a', itemId: 'proposal-a' }, query: {}, body: { action: 'reject', markdown: 'Needs revision.' } },
	]);
	assert.deepEqual(calls.map((call) => (call.options?.headers as Record<string, unknown>)['If-Match']), ['question-v3', 'proposal-v5']);
});

test('service and capacity workflows bind current control-plane operations without plaintext secrets', async () => {
	const calls: Array<{ operationId: string; input: Record<string, unknown>; options?: Record<string, unknown> }> = [];
	const invoke = async (operationId: string, input: Record<string, unknown>, options?: Record<string, unknown>) => { calls.push({ operationId, input, options }); return { data: { ok: true } }; };
	await executeSurfaceAction(invoke, 'team-a', 'service.connect', { providerId: 'github', displayName: 'GitHub', capabilities: '[{"capabilityType":"repository"}]' });
	await executeSurfaceAction(invoke, 'team-a', 'service.configure', { displayName: 'GitHub projects' }, { id: 'service-a', title: 'GitHub', description: '', raw: { version: 3 } });
	await executeSurfaceAction(invoke, 'team-a', 'capacity.configure', { mode: 'local', approval: 'trusted-local-owner' });
	assert.deepEqual(calls.map((call) => call.operationId), ['services.connections.create', 'services.connections.update', 'providers.connect']);
	assert.deepEqual(calls[0]?.input.body, { providerId: 'github', displayName: 'GitHub', capabilities: [{ capabilityType: 'repository' }] });
	assert.equal(JSON.stringify(calls).includes('credential'), false);
	assert.equal((calls[1]?.options?.headers as Record<string, unknown>)['If-Match'], '3');
	assert.equal(calls[2]?.options?.uiConfirmed, true);
});

test('TreeDX authoring creates, writes, and submits one recoverable workspace', async () => {
	const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
	const invoke = async (operationId: string, input: Record<string, unknown>) => {
		calls.push({ operationId, input });
		if (operationId === 'knowledge.workspaces.create') return { data: { id: 'workspace-a', version: 1 } };
		if (operationId === 'knowledge.workspaces.content.update') return { data: { workspace: { id: 'workspace-a', version: 2 } } };
		return { data: { review: { id: 'review-a' } } };
	};
	await executeSurfaceAction(invoke, 'team-a', 'content.edit', { projectId: 'project-a', bookId: 'handbook', slug: 'welcome', title: 'Welcome', summary: 'Start here', body: '# Welcome', message: 'Add welcome page' });
	assert.deepEqual(calls.map((call) => call.operationId), ['knowledge.workspaces.create', 'knowledge.workspaces.content.update', 'knowledge.workspaces.submit']);
	assert.deepEqual(calls[1]?.input.body, { kind: 'page', version: 1, sourcePath: undefined, bookId: 'handbook', slug: 'welcome', title: 'Welcome', summary: 'Start here', body: '# Welcome' });
	assert.deepEqual(calls[2]?.input.body, { version: 2, message: 'Add welcome page' });
});

test('allocation authoring validates normalized hierarchy percentages before writing TreeDX content', async () => {
	const calls: string[] = [];
	const invoke = async (operationId: string) => {
		calls.push(operationId);
		if (operationId === 'knowledge.workspaces.create') return { data: { id: 'workspace-a', version: 1 } };
		if (operationId === 'knowledge.workspaces.content.update') return { data: { workspace: { version: 2 } } };
		return { data: { review: { id: 'review-a' } } };
	};
	const allocation = { schemaVersion: 2, id: 'allocation-a', teamId: 'team-a', version: 1, status: 'draft', effectiveFrom: '2026-09-02T12:00:00.000Z', reservePolicy: { percent: 0, overflow: 'deny' }, slices: [{ id: 'project-a', scope: 'project', targetId: 'project-a', policy: { minPercent: 0, targetPercent: 100, maxPercent: 100, hardCapPercent: 100 } }], borrowingRules: [] };
	await executeSurfaceAction(invoke, 'team-a', 'allocation.save', { projectId: 'project-a', sourcePath: 'capacity/allocations/team.yaml', content: JSON.stringify(allocation), message: 'Allocate project capacity' });
	assert.deepEqual(calls, ['knowledge.workspaces.create', 'knowledge.workspaces.content.update', 'knowledge.workspaces.submit']);
	await assert.rejects(() => executeSurfaceAction(invoke, 'team-a', 'allocation.save', { projectId: 'project-a', sourcePath: 'capacity/allocations/team.yaml', content: JSON.stringify({ ...allocation, slices: [{ ...allocation.slices[0], policy: { ...allocation.slices[0].policy, targetPercent: 90 } }] }), message: 'Invalid allocation' }), /Sibling target percentages must total 100/u);
});

test('release workflows publish staging and leave production fail-closed to control-plane authority', async () => {
	const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
	const invoke = async (operationId: string, input: Record<string, unknown>) => { calls.push({ operationId, input }); return { data: { operation: { id: 'operation-a' } } }; };
	const selected = { id: 'review-a', title: 'Review A', description: '', status: 'approved', raw: { status: 'approved', etag: 'review-v2' } };
	await executeSurfaceAction(invoke, 'team-a', 'release.cut', { notes: 'Validated on staging' }, selected);
	await executeSurfaceAction(invoke, 'team-a', 'release.promote-production', { confirmation: 'PROMOTE', notes: 'Human approval' }, selected);
	assert.deepEqual(calls.map((call) => call.input), [
		{ path: { reviewId: 'review-a' }, query: {}, body: { targetEnvironment: 'staging', notes: 'Validated on staging' } },
		{ path: { reviewId: 'review-a' }, query: {}, body: { targetEnvironment: 'production', notes: 'Human approval' } },
	]);
});

test('workspace shortcuts use terminal-portable digits without stealing composer input', () => {
	assert.equal(workspaceShortcut('1', false, false), 'team');
	assert.equal(workspaceShortcut('4', false, false), 'discover');
	assert.equal(workspaceShortcut('2', false, true), undefined);
	assert.equal(workspaceShortcut('2', true, true), 'chat');
	assert.equal(workspaceShortcut('x', false, false), undefined);
});

test('help documents the integrated interface without removing machine commands', () => {
	const help = renderHelp();
	assert.match(help, /integrated (?:Team|Follow), Chat, Inbox, and (?:Discover|Explore) interface/u);
	assert.match(help, /trsd ui --surface/u);
	assert.match(help, /Machine-oriented commands/u);
});
