import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspectPlatformRepository } from '../../../src/cli/handlers/runtime/platform-repository-status.ts';

test('platform repository status reports an actionable missing workset checkout', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-platform-status-'));
	const status = inspectPlatformRepository(root, {
		projectId: 'project-sdk', role: 'primary', path: 'packages/sdk', repository: 'treeseed-ai/sdk', branch: 'staging',
	});
	assert.equal(status.state, 'missing');
	assert.match(status.repair ?? '', /platform workset --apply --yes/u);
});
