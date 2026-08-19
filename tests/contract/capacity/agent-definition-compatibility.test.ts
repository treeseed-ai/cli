import assert from 'node:assert/strict';
import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe,it } from 'node:test';
import { validateAgentDefinitionModel } from '@treeseed/sdk/agent-capacity';
import { parse as parseYaml } from 'yaml';

describe('CLI shipped agent definitions', () => {
	it('remain compatible with the SDK authority and capacity-provider contract', async () => {
		const { validateAgentActivityProfileCompatibility } = await import(pathToFileURL(resolve(process.cwd(),'node_modules/@treeseed/sdk/dist/agent-capacity/validation/compatibility/agent-definition-compatibility.js')).href);
		const root = resolve(process.cwd(),'docs/src/content/agents');
		const names = readdirSync(root).filter((entry) => entry.endsWith('.mdx')).sort();
		assert.ok(names.length > 0);
		for (const name of names) {
			const source = readFileSync(resolve(root,name),'utf8');
			const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
			assert.ok(match,`${name} must contain YAML frontmatter`);
			const definition = parseYaml(match[1]) as Record<string,any>;
			assert.deepEqual(validateAgentDefinitionModel(definition).diagnostics,[],name);
			for (const [activityType,profile] of Object.entries(definition.activityProfiles ?? {}) as Array<[any,any]>) {
				if (profile.enabled) assert.deepEqual(validateAgentActivityProfileCompatibility(activityType,profile).diagnostics,[],name);
			}
		}
	});
});
