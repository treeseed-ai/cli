import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { controlPlaneOperation } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';

type Input = { path: Record<string, unknown>; query: Record<string, unknown>; body: unknown };

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const data = (value: unknown) => { const outer = record(value); return record(outer.data ?? outer); };
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const number = (value: unknown) => value === undefined ? undefined : Number(value);

async function inputFile(invocation: ParsedInvocation, context: CommandContext) {
	const file = text(invocation.options.input);
	if (!file) return {};
	let source = '';
	if (file === '-') {
		process.stdin.setEncoding('utf8');
		for await (const chunk of process.stdin) source += String(chunk);
	} else source = await readFile(resolve(context.cwd, file), 'utf8');
	const parsed = parseYaml(source);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('Library input must be one YAML or JSON object.'), { category: 'invalid_input', code: 'library_input_invalid' });
	return parsed as Record<string, unknown>;
}

export async function resolveActiveTeamLibraryProject(invocation: ParsedInvocation, context: CommandContext) {
	if (context.operationInvoke) return;
	const requestedProject = String(invocation.arguments[0] ?? '');
	if (!requestedProject) return;
	const realClient = await createControlPlaneClient(invocation, context, true);
	const activeTeamId = realClient.session?.activeTeam?.id;
	let cursor: string | undefined;
	const matches: Record<string, any>[] = [];
	do {
		const response = data(await realClient.client.invoke(controlPlaneOperation('projects.list'), {
			path: {}, query: { limit: 200, ...(cursor ? { cursor } : {}) },
			body: undefined,
		}));
		for (const project of response.items ?? []) if ([project.id, project.slug].includes(requestedProject)
			&& (!activeTeamId || String(project.teamId ?? project.team_id ?? '') === activeTeamId)) matches.push(project);
		cursor = text(response.page?.nextCursor ?? response.nextCursor);
	} while (cursor && matches.length < 2);
	if (matches.length !== 1) {
		const code = matches.length ? 'project_ambiguous' : 'project_not_found';
		throw Object.assign(new Error(matches.length ? `Project ${requestedProject} is ambiguous.` : `Project ${requestedProject} was not found.`), {
			category: matches.length ? 'ambiguous_context' : 'not_found', code,
		});
	}
	invocation.arguments[0] = String(matches[0]!.id);
}

export async function runLibrary(invocation: ParsedInvocation, context: CommandContext) {
	const realClient = context.operationInvoke ? null : await createControlPlaneClient(invocation, context, true);
	const activeTeamId = realClient?.session?.activeTeam?.id;
	const invoke = async (operationId: string, input: Input) => context.operationInvoke
		? context.operationInvoke(operationId, input)
		: realClient!.client.invoke(controlPlaneOperation(operationId), input);
	const requestedProject = String(invocation.arguments[0] ?? '');
	let cursor: string | undefined;
	const matches: Record<string, any>[] = [];
	do {
		const response = data(await invoke('projects.list', { path: {}, query: { limit: 200, ...(cursor ? { cursor } : {}) }, body: undefined }));
		for (const project of response.items ?? []) if ([project.id, project.slug].includes(requestedProject)
			&& (!activeTeamId || String(project.teamId ?? project.team_id ?? '') === activeTeamId)) matches.push(project);
		cursor = text(response.page?.nextCursor ?? response.nextCursor);
	} while (cursor && matches.length < 2);
	if (matches.length !== 1) {
		const code = matches.length ? 'project_ambiguous' : 'project_not_found';
		throw Object.assign(new Error(matches.length ? `Project ${requestedProject} is ambiguous.` : `Project ${requestedProject} was not found.`), { category: matches.length ? 'ambiguous_context' : 'not_found', code });
	}
	const projectId = String(matches[0]!.id);
	const libraryResponse = await invoke('treedx.library.show', { path: { projectId }, query: {}, body: undefined });
	const library = data(libraryResponse);
	const repoId = text(library.repositoryId);
	if (!repoId) throw Object.assign(new Error('The project library has no TreeDX repository binding.'), { category: 'provider_unavailable', code: 'library_binding_unavailable' });
	const ref = text(invocation.options.ref) ?? text(library.contentRepositoryRef) ?? 'refs/heads/staging';
	const command = invocation.command.path[1];
	if (command === 'show') return { project: matches[0], library };
	if (command === 'status') {
		const [repository, status, index] = await Promise.all([
			invoke('treedx.repositories.show', { path: { projectId, repoId }, query: {}, body: undefined }),
			invoke('treedx.repositories.status', { path: { projectId, repoId }, query: {}, body: undefined }),
			invoke('treedx.repositories.search.index.status', { path: { projectId, repoId }, query: { ref }, body: undefined }),
		]);
		return { project: matches[0], library, repository: data(repository), status: data(status), searchIndex: data(index) };
	}
	if (command === 'paths') {
		const prefix = text(invocation.options.prefix)?.replace(/^\/+|\/+$/gu, '');
		return invoke('treedx.repositories.paths.list', { path: { projectId, repoId }, query: {}, body: { ref, paths: [prefix ? `${prefix}/**` : '**'], kinds: ['blob'], limit: number(invocation.options.limit) ?? 100, ...(text(invocation.options.cursor) ? { cursor: text(invocation.options.cursor) } : {}) } });
	}
	if (command === 'read') return invoke('treedx.repositories.files.read', { path: { projectId, repoId }, query: {}, body: { ref, paths: [String(invocation.arguments[1])], encoding: 'utf8', parseFrontmatter: true } });
	if (command === 'search') {
		const prefix = text(invocation.options.path)?.replace(/^\/+|\/+$/gu, '');
		return invoke('treedx.repositories.files.search', { path: { projectId, repoId }, query: {}, body: { ref, query: String(invocation.arguments[1]), paths: [prefix ? `${prefix}/**` : '**'], limit: number(invocation.options.limit) ?? 50, includeFrontmatter: true, includeBody: false, ...(text(invocation.options.cursor) ? { cursor: text(invocation.options.cursor) } : {}) } });
	}
	const supplied = await inputFile(invocation, context);
	if (command === 'query') return invoke('treedx.repositories.query', { path: { projectId, repoId }, query: {}, body: { ref, query: String(invocation.arguments[1]), ...(text(invocation.options.model) ? { model: text(invocation.options.model) } : {}), ...supplied } });
	if (command === 'context') return invoke('treedx.repositories.context.build', { path: { projectId, repoId }, query: {}, body: { ref, query: String(invocation.arguments[1]), maxItems: number(invocation.options.maxItems), maxTokens: number(invocation.options.maxTokens), ...supplied } });
	throw Object.assign(new Error(`Unsupported library command ${command}.`), { category: 'invalid_input', code: 'library_command_invalid' });
}
