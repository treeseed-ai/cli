import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { hydrateProjectEnvironment } from '../../../src/cli/runtime/runtime-environment.ts';

test('CLI commands hydrate machine-local Platform identity', () => {
	const root=mkdtempSync(resolve(tmpdir(),'cli-platform-identity-'));
	try {
		writeFileSync(resolve(root,'treeseed.site.yaml'),'name: Platform\nslug: platform\nsiteUrl: https://example.test\ncontactEmail: test@example.test\n');
		mkdirSync(resolve(root,'.treeseed/config'),{recursive:true});
		writeFileSync(resolve(root,'.treeseed/template-state.json'),'{}\n');
		writeFileSync(resolve(root,'.treeseed/config/machine.yaml'),`version: 1\nshared:\n  values:\n    TREESEED_HOSTING_TEAM_ID: treeseed\n    TREESEED_PROJECT_ID: platform\n  secrets: {}\nenvironments:\n  local: { values: {}, secrets: {} }\n  staging: { values: {}, secrets: {} }\n  prod: { values: {}, secrets: {} }\n`);
		const env=hydrateProjectEnvironment(root,{});
		assert.equal(env.TREESEED_HOSTING_TEAM_ID,'treeseed');
		assert.equal(env.TREESEED_PROJECT_ID,'platform');
	} finally { rmSync(root,{recursive:true,force:true}); }
});
