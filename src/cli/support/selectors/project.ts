import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { createControlPlaneClient } from '../client.js';

type Project = { id: string; slug: string; teamId?: string; team_id?: string };
type Page = { items?: Project[]; projects?: Project[]; page?: { hasMore?: boolean; nextCursor?: string | null } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function resolveProjectSelector(
	selector: string,
	teamId: string | undefined,
	read: (cursor?: string) => Promise<Page>,
): Promise<string> {
	if (uuid.test(selector)) return selector;
	const matches = new Set<string>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; page < 100; page += 1) {
		const result = await read(cursor);
		for (const project of result.items ?? result.projects ?? []) {
			const projectTeamId = project.teamId ?? project.team_id;
			if ((!teamId || !projectTeamId || projectTeamId === teamId)
				&& (project.id === selector || project.slug.toLowerCase() === selector.toLowerCase())) matches.add(project.id);
		}
		if (!result.page?.hasMore) {
			if (matches.size !== 1) throw Object.assign(
				new Error(matches.size ? 'Project selector is ambiguous.' : 'Project is not accessible.'),
				{ category: matches.size ? 'ambiguous_context' : 'not_found', code: matches.size ? 'project_ambiguous' : 'project_not_found' },
			);
			return [...matches][0]!;
		}
		const next = result.page.nextCursor;
		if (!next || cursors.has(next)) throw new Error('Project inventory pagination is incomplete.');
		cursors.add(next);
		cursor = next;
	}
	throw new Error('Project inventory exceeds the bounded lookup limit.');
}

export async function resolveExplicitProject(
	invocation: ParsedInvocation,
	context: CommandContext,
	selector: string,
	teamId?: string,
) {
	return resolveProjectSelector(selector, teamId, async cursor => {
		const input = { path: {}, query: { limit: 200, ...(teamId ? { teamId } : {}), ...(cursor ? { cursor } : {}) }, body: undefined };
		const response = context.operationInvoke
			? await context.operationInvoke('projects.list', input)
			: await (await createControlPlaneClient(invocation, context, true)).client.invoke(CONTROL_PLANE_OPERATIONS.projects.list, input);
		const value = response as { data?: Page } & Page;
		return value.data ?? value;
	});
}
