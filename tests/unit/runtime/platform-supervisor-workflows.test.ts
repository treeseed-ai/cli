import assert from 'node:assert/strict';
import test from 'node:test';
import {
	activePlatformWorkflow,
	runPlatformMutationWhenAvailable,
} from '../../../src/cli/handlers/runtime/platform-supervisor-workflows.ts';
import type { PlatformSupervisorState } from '../../../src/cli/handlers/runtime/platform-supervisor-state.ts';

test('platform supervisor defers each mutation when a workflow becomes active between phases', async () => {
	let activeScope: 'worktree' | 'shared' | null = null;
	const inspectedScopes: string[] = [];
	const inspect = (_root: string, options: { scope: 'worktree' | 'shared' }) => {
		inspectedScopes.push(options.scope);
		return options.scope === activeScope
			? { active: true, lock: { runId: 'stage-active', command: 'stage' } }
			: { active: false, lock: null };
	};
	const state: PlatformSupervisorState = { pid: process.pid, startedAt: new Date().toISOString() };
	let reconciled = false;

	const updated = await runPlatformMutationWhenAvailable('/workspace', state, async () => {
		activeScope = 'shared';
	}, inspect);
	const converged = await runPlatformMutationWhenAvailable('/workspace', state, async () => {
		reconciled = true;
	}, inspect);

	assert.equal(updated, true);
	assert.equal(converged, false);
	assert.equal(reconciled, false);
	assert.deepEqual(state.deferredByWorkflow, { scope: 'shared', runId: 'stage-active', command: 'stage' });
	assert.deepEqual(inspectedScopes, ['worktree', 'shared', 'worktree', 'shared']);
});

test('platform workflow inspection gives worktree activity precedence', () => {
	const blocker = activePlatformWorkflow('/workspace', (_root, options) => ({
		active: true,
		lock: { runId: `${options.scope}-active`, command: options.scope === 'shared' ? 'stage' : 'save' },
	}));
	assert.deepEqual(blocker, { scope: 'worktree', runId: 'worktree-active', command: 'save' });
});
