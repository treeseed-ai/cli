import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliReleaseVersion } from '../../../scripts/packages/release-version.ts';

test('CLI release versions route stable and RC artifacts to isolated npm tags', () => {
	assert.deepEqual(parseCliReleaseVersion('0.13.0', '0.13.0'), { channel: 'stable', distTag: 'latest' });
	assert.deepEqual(parseCliReleaseVersion('0.13.0-rc.1', '0.13.0-rc.1'), { channel: 'prerelease', distTag: 'rc' });
});

test('CLI release versions reject mismatches and unsupported prerelease channels', () => {
	assert.throws(() => parseCliReleaseVersion('0.13.0-rc.1', '0.13.0-rc.2'), /does not match/u);
	assert.throws(() => parseCliReleaseVersion('0.13.0-beta.1', '0.13.0-beta.1'), /stable or rc\.N/u);
	assert.throws(() => parseCliReleaseVersion('v0.13.0', 'v0.13.0'), /stable or rc\.N/u);
});
