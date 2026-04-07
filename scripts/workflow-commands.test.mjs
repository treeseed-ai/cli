import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	loadDeployState,
} from './deploy-lib.ts';
import { renderDeployWorkflow } from './github-automation-lib.ts';
import { incrementVersion } from './workspace-save-lib.ts';

function makeTenantRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-cli-test-'));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), [
		'name: Example',
		'slug: example',
		'siteUrl: https://example.com',
		'contactEmail: hello@example.com',
		'cloudflare:',
		'  accountId: acct_123',
		'  workerName: example',
		'plugins: []',
		'providers:',
		'  forms: store_only',
		'  agents:',
		'    execution: stub',
		'    mutation: local_branch',
		'    repository: stub',
		'    verification: stub',
		'    notification: stub',
		'    research: stub',
		'  deploy: cloudflare',
		'  content:',
		'    docs: default',
		'  site: default',
		'smtp:',
		'  enabled: false',
		'turnstile:',
		'  enabled: false',
		'',
	].join('\n'));
	mkdirSync(resolve(root, 'migrations'), { recursive: true });
	return root;
}

test('persistent and branch targets produce distinct labels', () => {
	assert.equal(deployTargetLabel(createPersistentDeployTarget('staging')), 'staging');
	assert.equal(deployTargetLabel(createBranchPreviewDeployTarget('feature/one')), 'branch:feature/one');
});

test('branch preview state derives branch-specific worker names', () => {
	const tenantRoot = makeTenantRoot();
	const deployConfig = {
		cloudflare: { accountId: 'acct_123', workerName: 'example' },
	};
	const state = loadDeployState(tenantRoot, deployConfig, { target: createBranchPreviewDeployTarget('feature/preview') });
	assert.match(state.workerName, /^example-feature-preview/);
	assert.equal(state.previewEnabled, true);
});

test('deploy workflow targets staging and main branches', () => {
	const workflow = renderDeployWorkflow({ workingDirectory: '.' });
	assert.match(workflow, /- staging/);
	assert.match(workflow, /- main/);
	assert.match(workflow, /--environment \$\{\{ github\.ref_name == 'main' && 'prod' \|\| 'staging' \}\}/);
});

test('version bump utility supports major, minor, and patch', () => {
	assert.equal(incrementVersion('1.2.3', 'patch'), '1.2.4');
	assert.equal(incrementVersion('1.2.3', 'minor'), '1.3.0');
	assert.equal(incrementVersion('1.2.3', 'major'), '2.0.0');
});
