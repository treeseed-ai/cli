import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformUserServiceIdentity, platformUserServiceStopArgs, renderPlatformUserService } from '../../../src/cli/handlers/runtime/run.ts';

test('platform user service preserves the executable and operator tool path across login and reboot', () => {
	const service = renderPlatformUserService({
		root: '/workspace/market',
		executable: '/opt/node/bin/node',
		entrypoint: '/workspace/market/node_modules/.bin/trsd',
		pathValue: '/usr/local/bin:/usr/bin:/opt/node/bin',
	});
	assert.match(service, /Environment="PATH=\/opt\/node\/bin:\/usr\/local\/bin:\/usr\/bin"/u);
	assert.match(service, /ExecStart="\/opt\/node\/bin\/node" "\/workspace\/market\/node_modules\/\.bin\/trsd" platform supervise --json/u);
});

test('platform user-service identity is stable and worktree scoped', () => {
	const first = platformUserServiceIdentity('/workspace/one');
	const repeated = platformUserServiceIdentity('/workspace/one');
	const second = platformUserServiceIdentity('/workspace/two');

	assert.deepEqual(first, repeated);
	assert.notEqual(first.unit, second.unit);
	assert.match(first.unit, /^treeseed-platform-[a-z0-9_-]+\.service$/u);
});

test('platform stop disables reboot restart while pause preserves it', () => {
	assert.deepEqual(platformUserServiceStopArgs('stop'), ['--user', 'disable', '--now']);
	assert.deepEqual(platformUserServiceStopArgs('pause'), ['--user', 'stop']);
});
