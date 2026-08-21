import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readBackPublishedPackage } from '../../../scripts/packages/published-package-readback.ts';

const artifact = Buffer.from('verified-cli-artifact');
const digest = createHash('sha256').update(artifact).digest('hex');
const input = {
	packageName: '@treeseed/cli', packageVersion: '0.13.0-rc.1', packageDigest: digest,
	distTag: 'rc' as const, expectedLatest: '0.12.58', destination: '/fixture', cwd: '/fixture',
	readArtifact: () => artifact,
};

test('published read-back retries only visibility and dist-tag propagation', async () => {
	const notVisible = Object.assign(new Error('not visible'), { stderr: 'npm ERR! code ETARGET' });
	const values: Array<string | Error> = [notVisible, '[{"filename":"package.tgz"}]', '{"latest":"0.12.58"}', '{"latest":"0.12.58","rc":"0.13.0-rc.1"}'];
	let calls = 0;
	let now = 0;
	const result = await readBackPublishedPackage({
		...input,
		execNpm: () => { const value = values[calls++]!; if (value instanceof Error) throw value; return value; },
		now: () => now,
		delay: async (milliseconds) => { now += milliseconds; },
	});
	assert.deepEqual(result, { packageVersion: '0.13.0-rc.1', packageDigest: digest, distTag: 'rc', latest: '0.12.58' });
	assert.equal(calls, 4);
});

test('published read-back stops at its overall deadline', async () => {
	const timeout = Object.assign(new Error('timed out'), { stderr: 'npm ERR! code ETIMEDOUT' });
	let now = 0;
	let calls = 0;
	await assert.rejects(readBackPublishedPackage({
		...input,
		execNpm: () => { calls += 1; throw timeout; },
		deadlineMs: 5,
		now: () => now,
		delay: async (milliseconds) => { now += milliseconds; },
	}), /timed out/u);
	assert.equal(now, 5);
	assert.equal(calls, 2);
});

test('published read-back fails immediately on authentication errors', async () => {
	let delays = 0;
	await assert.rejects(readBackPublishedPackage({
		...input,
		execNpm: () => { throw Object.assign(new Error('unauthorized'), { stderr: 'npm ERR! code E401' }); },
		delay: async () => { delays += 1; },
	}), /unauthorized/u);
	assert.equal(delays, 0);
});

test('published read-back fails immediately when latest moves', async () => {
	const values = ['[{"filename":"package.tgz"}]', '{"latest":"0.13.0-rc.1","rc":"0.13.0-rc.1"}'];
	let calls = 0;
	await assert.rejects(readBackPublishedPackage({ ...input, execNpm: () => values[calls++]! }), /npm latest changed/u);
	assert.equal(calls, 2);
});

test('published read-back checks artifact identity before dist-tags', async () => {
	let calls = 0;
	await assert.rejects(readBackPublishedPackage({
		...input, packageDigest: 'wrong', execNpm: () => { calls += 1; return '[{"filename":"package.tgz"}]'; },
	}), /does not match/u);
	assert.equal(calls, 1);
});
