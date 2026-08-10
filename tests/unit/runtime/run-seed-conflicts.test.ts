import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { compileSeedSet } from '../../../src/cli/handlers/runtime/run.ts';

function seed(name: string, executionProviderId: string) {
	return `name: ${name}\nversion: 1\ndefaultEnvironments: [local]\nenvironments: [local]\nreferences: [team:example, project:example/app]\nresources: {}\nruntime:\n  capacityProviders:\n    - key: capacity-provider:example/agents\n      providerClass: agent\n      environments: [local]\n      team: team:example\n      manifest: provider.yaml\n      connectionId: primary\n      approval: trusted-local-owner\n      projects: [project:example/app]\n      allowedModes: [planning]\n      executionProviderIds: [${executionProviderId}]\n  agentLabServicePrincipals: []\noperationRecipes: []\n`;
}

test('run rejects conflicting runtime prerequisite ownership across selected seeds', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-run-seed-conflict-'));
	try {
		mkdirSync(resolve(root, 'seeds'));
		writeFileSync(resolve(root, 'seeds/one.yaml'), seed('one', 'codex-sub'));
		writeFileSync(resolve(root, 'seeds/two.yaml'), seed('two', 'codex-key'));

		const result = compileSeedSet(root, ['one', 'two']);
		assert.equal(result.ok, false);
		assert.ok(result.diagnostics.some((entry) => entry.code === 'seed.desired_identity_conflict'
			&& entry.path === 'capacityProvider:capacity-provider:example/agents'), JSON.stringify(result.diagnostics));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
