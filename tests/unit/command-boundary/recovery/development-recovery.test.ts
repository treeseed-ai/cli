import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { applyDevelopmentRecovery, matchDevelopmentProcess, planDevelopmentRecovery } from '../../../../src/cli/commands/development-support/recovery.ts';

test('recovery matches exact session, cwd and invocation, rejecting duplicates', () => {
	const expected = { sessionId: 'dev-one', worktree: '/workspace', cwd: '/workspace', command: 'node', args: ['watch.js'] };
	const process = { ...expected, pid: 11, processGroup: 11, argv: ['/usr/bin/node', 'watch.js'] };
	assert.equal(matchDevelopmentProcess([process], expected)?.pid, 11);
	for (const changed of [{ sessionId: 'dev-other' }, { cwd: '/another' }, { processGroup: 12 }, { argv: ['/usr/bin/node', 'other.js'] }])
		assert.equal(matchDevelopmentProcess([{ ...process, ...changed }], expected), undefined);
	assert.throws(() => matchDevelopmentProcess([process, { ...process, pid: 12, processGroup: 12 }], expected), /Ambiguous/);
});

test('recovery plan does not write, apply preserves current session, missing process fails closed', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-recovery-'));
	try {
		const worktree = resolve(root, 'project'), stateRoot = resolve(root, 'state'); mkdirSync(worktree);
		writeFileSync(resolve(root, 'treeseed.site.yaml'), '{}');
		const env = { XDG_STATE_HOME: stateRoot }, directory = resolve(stateRoot, 'treeseed/development');
		mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'current.json'), '{"sessionId":"dev-other"}');
		const record: any = { session: { sessionId: 'dev-one', status: 'active', repositories: [{ projectId: 'web', worktree }], targets: [{ projectId: 'web', targetId: 'web', mode: 'live' }] },
			runtimes: [{ project: { id: 'web' }, targets: [{ id: 'web', kind: 'live-web', operations: { start: { command: 'node', args: ['watch.js'] } } }] }] };
		writeFileSync(resolve(worktree, 'treeseed.package.yaml'), JSON.stringify({ development: record.runtimes[0] }));
		assert.throws(() => planDevelopmentRecovery(record, env, []), /No unique owned process/);
		const plan = planDevelopmentRecovery(record, env, [{ pid: 11, processGroup: 11, cwd: worktree, worktree, sessionId: 'dev-one', argv: ['/usr/bin/node', 'watch.js'] }]);
		const expired = planDevelopmentRecovery({ ...record, session: { ...record.session, status: 'expired' } }, env, []);
		assert.deepEqual(expired.state.processes, {});
		assert.equal(existsSync(plan.state.manifest), false);
		applyDevelopmentRecovery(plan);
		assert.equal(JSON.parse(readFileSync(resolve(directory, 'current.json'), 'utf8')).sessionId, 'dev-other');
		assert.equal(JSON.parse(readFileSync(resolve(directory, 'dev-one/session.json'), 'utf8')).processes['web.web'].pid, 11);
		assert.throws(() => applyDevelopmentRecovery(plan), /already exists/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
