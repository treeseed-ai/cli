import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readConfigurationGeneration } from '@treeseed/sdk/workflow-support';

export type PlatformSupervisorState = {
	pid: number;
	startedAt: string;
	lastConvergedAt?: string;
	lastRemotePollAt?: string;
	lastDeferredAt?: string;
	deferredByWorkflow?: { scope: 'worktree' | 'shared'; runId: string; command: string };
	lastError?: string;
	generationId?: string;
};

export function platformSupervisorPaths(root: string) {
	const directory = resolve(root, '.treeseed', 'run');
	return { state: resolve(directory, 'supervisor.json'), log: resolve(directory, 'supervisor.log') };
}

export function processIsAlive(pid: number | undefined) {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readPlatformSupervisor(root: string): PlatformSupervisorState | null {
	try { return JSON.parse(readFileSync(platformSupervisorPaths(root).state, 'utf8')) as PlatformSupervisorState; } catch { return null; }
}

export async function waitForPlatformGeneration(root: string, generationId: string, timeoutMs = 120_000): Promise<{
	status: 'pending' | 'applied' | 'failed'; reason?: string; generation?: Record<string, unknown>;
}> {
	const supervisor = readPlatformSupervisor(root);
	if (!supervisor || !processIsAlive(supervisor.pid)) return { status: 'pending' as const, reason: 'platform_not_running' };
	const expiresAt = Date.now() + timeoutMs;
	while (Date.now() < expiresAt) {
		const generation = readConfigurationGeneration(root);
		if (generation?.id === generationId && generation.status !== 'pending') return { status: generation.status, generation };
		if (!processIsAlive(readPlatformSupervisor(root)?.pid)) return { status: 'failed' as const, reason: 'platform_supervisor_stopped' };
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	return { status: 'pending' as const, reason: 'platform_reconciliation_timeout' };
}
