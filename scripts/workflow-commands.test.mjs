import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	deployTargetLabel,
	loadDeployState,
} from './deploy-lib.ts';
import { renderDeployWorkflow } from './github-automation-lib.ts';
import { incrementVersion } from './workspace-save-lib.ts';
import { makeTenantRoot } from './cli-test-fixtures.mjs';

test('persistent and branch targets produce distinct labels', () => {
	assert.equal(deployTargetLabel(createPersistentDeployTarget('staging')), 'staging');
	assert.equal(deployTargetLabel(createBranchPreviewDeployTarget('feature/one')), 'branch:feature/one');
});

test('branch preview state derives branch-specific worker names', () => {
	const tenantRoot = makeTenantRoot();
	const deployConfig = {
		cloudflare: { accountId: 'fixture-cloudflare-account-id', workerName: 'treeseed-working-site' },
	};
	const state = loadDeployState(tenantRoot, deployConfig, { target: createBranchPreviewDeployTarget('feature/preview') });
	assert.match(state.workerName, /^treeseed-working-site-feature-preview/);
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
