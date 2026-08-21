import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';

const documentCommands = new Set(['providers offers validate', 'providers offers plan', 'providers offers apply', 'workdays profiles validate']);

function apiRequest<T>(client: unknown, path: string, body: unknown) {
	return (client as { request<TValue>(path: string, options: { method: string; body: unknown; requireAuth: boolean }): Promise<TValue> }).request<T>(path, { method: 'POST', body, requireAuth: true });
}

export async function runOperator(invocation: ParsedInvocation, context: CommandContext) {
	const options = { ...invocation.options } as Record<string, unknown>;
	delete options.market; delete options.team; delete options.project; delete options.json; delete options.yes; delete options.plan;
	if (documentCommands.has(invocation.command.name)) {
		const file = invocation.arguments[0];
		if (!file) throw new Error('A repository-governed document path is required.');
		options.document = parseYaml(await readFile(resolve(context.cwd, file), 'utf8')) as unknown;
	}
	const manage = invocation.command.kind === 'mutation' || invocation.command.name === 'workdays plan';
	const path = `/v1/operator/commands/${manage ? 'mutations' : 'read'}`;
	const team = typeof invocation.options.team === 'string' ? invocation.options.team : context.env.TREESEED_TEAM_ID;
	const project = typeof invocation.options.project === 'string' ? invocation.options.project : context.env.TREESEED_PROJECT_ID;
	const body = {
		schemaVersion: 'treeseed.operator-command-request/v1',
		commandPath: invocation.command.path,
		arguments: invocation.arguments,
		options,
		mode: invocation.options.plan === true ? 'plan' : 'execute',
		context: { ...(team ? { team } : {}), ...(project ? { project } : {}) },
	};
	if (context.apiRequest) return context.apiRequest(path, body);
	const { client } = createControlPlaneClient(invocation, context, true);
	return apiRequest<{ ok: boolean; payload?: unknown; code?: string; error?: string }>(client, path, body);
}
