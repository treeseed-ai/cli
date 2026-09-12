import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withOsCustodyLock } from '../../support/server-custody.js';
import { developmentStateRoot } from '../development-cli-selection.js';
import { ownsDevelopmentProcess } from './process-identity.js';

export function assertNoSelectedDevelopmentCustody(env: NodeJS.ProcessEnv) {
	const selectedState = resolve(developmentStateRoot(env), 'current.json');
	if (!existsSync(selectedState)) return;
	const selected = JSON.parse(readFileSync(selectedState, 'utf8')) as { sessionId: string; processes?: Record<string, Parameters<typeof ownsDevelopmentProcess>[0]>; overlays?: unknown[] };
	const ownsProcesses = Object.values(selected.processes ?? {}).some((entry) => ownsDevelopmentProcess(entry, selected.sessionId));
	if (ownsProcesses || (selected.overlays ?? []).length > 0) throw new Error(`Development session ${selected.sessionId} still owns local processes or package overlays; stop or recover it before starting another session.`);
}

/** Shared builds and current.json cross session boundaries. Lock the Linux
 * operator's lifecycle, not a time-limited development selection. Deployment
 * owns the kernel-lock implementation; process death releases its descriptor.
 */
export async function withDevelopmentLifecycle<T>(env: NodeJS.ProcessEnv, action: () => Promise<T>, options: {
    waitForOwner?: boolean;
    lockTimeoutSeconds?: number;
} = {}): Promise<T> {
    if (process.platform !== 'linux') return action();
    for (;;) {
        let entered = false;
        try {
            return await withOsCustodyLock(resolve(developmentStateRoot(env), 'lifecycle'), async () => {
                entered = true;
                return action();
            }, options.lockTimeoutSeconds ?? 60);
        } catch (error) {
            // Only unattended acquisition waits again. Never replay a partially
            // executed lifecycle, even if it throws the same custody message.
            if (!options.waitForOwner || entered || !(error instanceof Error)
                || error.message !== 'OS custody is busy; retry the operation') throw error;
        }
    }
}

/** Reusing an immutable snapshot is not permission to overwrite its contents.
 * Source changes enter through explicit restart/rebuild, not another use/resume.
 */
export function managedContainerAlreadyReady(value: unknown, sessionId: string, targetId: string): boolean {
    const result = value as { registered?: unknown; state?: unknown; instances?: unknown; ready?: unknown };
    if (result?.registered === false) return false;
    if (result?.registered === true && Array.isArray(result.instances)) {
        const instances = result.instances as Array<{ sessionId?: unknown; target?: unknown; running?: unknown; health?: unknown }>;
        if (!instances.length || instances.some((item) => item.sessionId !== sessionId || typeof item.target !== 'string'
            || !item.target.endsWith(`.${targetId}`) || item.running !== true || item.health === 'starting' || item.health === 'unhealthy') || result.ready !== true)
            return false;
        return true;
    }
    if (result?.registered !== true || typeof result.state !== 'string') throw new Error('Managed runtime status is invalid.');
    let rows: Array<{ Name?: string; State?: string; Health?: string }>;
    try { rows = result.state.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch { throw new Error('Managed runtime status is invalid.'); }
    if (rows.length !== 1 || rows[0]?.Name !== `treeseed-${sessionId}-api-${targetId}`)
        throw new Error('Managed runtime identity is inconsistent; inspect the session before restarting.');
    if (rows[0].State !== 'running' || rows[0].Health !== 'healthy')
        return false;
    return true;
}
