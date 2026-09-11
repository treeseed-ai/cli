import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ownsDevelopmentProcess, processIdentity } from '../../../../src/cli/commands/development-support/process-identity.ts';

test('process custody rejects reused PID identity and foreign sessions', async () => {
	const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
		detached: true, stdio: 'ignore', env: { ...process.env, TREESEED_DEVELOPMENT_SESSION_ID: 'dev-test' },
	});
	await once(child, 'spawn');
	try {
		const pid = child.pid!;
		const identity = processIdentity(pid);
		assert.ok(identity);
		assert.equal(ownsDevelopmentProcess({ pid, identity }, 'dev-test'), true);
		assert.equal(ownsDevelopmentProcess({ pid, identity: 'previous-boot:1' }, 'dev-test'), false);
		assert.equal(ownsDevelopmentProcess({ pid }, 'dev-other'), false);
		assert.equal(ownsDevelopmentProcess({ pid }, 'dev-test'), true);
	} finally { child.kill(); await once(child, 'exit'); }
});
