import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext } from '../../types.js';
type Invoke = (operation: any, input: unknown, mutation?: boolean) => Promise<unknown>;
const value = (response: any) => response && typeof response === 'object' && 'data' in response ? response.data : response;

/** Credentials stay behind API authority; the CLI only follows the authorized operation. */
export async function completeHostedTopologyOperation(response: unknown, _teamId: string, invoke: Invoke, _context: CommandContext) {
  const accepted = value(response);
  if (!accepted?.operation?.id) return accepted;
  for (let attempt = 0; attempt < 600; attempt++) {
    const current = value(await invoke(CONTROL_PLANE_OPERATIONS.operations.show,
      { path: { operationId: accepted.operation.id }, query: {}, body: undefined }));
    if (current?.status === 'completed') return current.output?.plan ?? current.output?.receipt ?? current.output;
    if (['cancelled', 'failed'].includes(current?.status))
      throw Object.assign(new Error('Hosted topology operation failed; inspect its redacted status.'),
        { category: 'operation_failed', code: 'hosted_topology_operation_failed' });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Hosted topology operation did not complete within five minutes.');
}
