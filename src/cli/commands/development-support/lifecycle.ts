import { resolve } from 'node:path';
import { withOsCustodyLock } from '@treeseed/deployment/security/custody';
import { developmentStateRoot } from '../development-cli-selection.js';

/** Shared builds and current.json cross session boundaries. Lock the Linux
 * operator's lifecycle, not a time-limited development selection. Deployment
 * owns the kernel-lock implementation; process death releases its descriptor.
 */
export function withDevelopmentLifecycle<T>(env: NodeJS.ProcessEnv, action: () => Promise<T>): Promise<T> {
    if (process.platform !== 'linux') return action();
    return withOsCustodyLock(resolve(developmentStateRoot(env), 'lifecycle'), action, 60);
}

/** Reusing an immutable snapshot is not permission to overwrite its contents.
 * Source changes enter through explicit restart/rebuild, not another use/resume.
 */
export function managedContainerAlreadyReady(value: unknown, sessionId: string, targetId: string): boolean {
    const result = value as { registered?: unknown; state?: unknown };
    if (result?.registered === false) return false;
    if (result?.registered !== true || typeof result.state !== 'string') throw new Error('Managed runtime status is invalid.');
    let rows: Array<{ Name?: string; State?: string; Health?: string }>;
    try { rows = result.state.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch { throw new Error('Managed runtime status is invalid.'); }
    if (rows.length !== 1 || rows[0]?.Name !== `treeseed-${sessionId}-api-${targetId}`)
        throw new Error('Managed runtime identity is inconsistent; inspect the session before restarting.');
    if (rows[0].State !== 'running' || rows[0].Health !== 'healthy')
        throw new Error('Managed runtime is not healthy; use dev restart to drain and recover it.');
    return true;
}
