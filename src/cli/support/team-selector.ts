import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from './client.js';

type Page = { items?: Array<{id: string; slug: string}>; teams?: Array<{id: string; slug: string}>; page?: {hasMore?: boolean; nextCursor?: string | null} };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export async function resolveTeamSelector(selector: string, read: (cursor?: string) => Promise<Page>): Promise<string> {
  if (uuid.test(selector)) return selector;
  const matches = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await read(cursor);
    for (const team of result.items ?? result.teams ?? []) {
      if (team.id === selector || team.slug.toLowerCase() === selector.toLowerCase()) matches.add(team.id);
    }
    if (!result.page?.hasMore) {
      if (matches.size !== 1) throw Object.assign(new Error(matches.size ? 'Team selector is ambiguous.' : 'Team is not accessible.'),
        {category: matches.size ? 'ambiguous_context' : 'not_found', code: matches.size ? 'team_ambiguous' : 'team_not_found'});
      return [...matches][0]!;
    }
    const next = result.page.nextCursor;
    if (!next || cursors.has(next)) throw new Error('Team inventory pagination is incomplete.');
    cursors.add(next); cursor = next;
  }
  throw new Error('Team inventory exceeds the bounded lookup limit.');
}

export async function resolveExplicitTeam(invocation: ParsedInvocation, context: CommandContext, selector: string) {
  return resolveTeamSelector(selector, async cursor => {
    const input = {path: {}, query: {limit: 500, ...(cursor ? {cursor} : {})}, body: undefined};
    const response = context.operationInvoke
      ? await context.operationInvoke('teams.list', input)
      : await (await createControlPlaneClient(invocation, context, true)).client.invoke(CONTROL_PLANE_OPERATIONS.teams.list, input);
    const value = response as {data?: Page} & Page;
    return value.data ?? value;
  });
}
