import assert from 'node:assert/strict';
import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,it } from 'node:test';
import { validateAgentDefinitionModel } from '@treeseed/sdk/agent-capacity';
import { parse as parseYaml } from 'yaml';

describe('CLI shipped agent definitions', () => {
	it('remain compatible with the SDK authority and capacity-provider contract', () => {
		const root = resolve(process.cwd(),'docs/src/content/agents');
		const names = readdirSync(root).filter((entry) => entry.endsWith('.mdx')).sort();
		assert.ok(names.length > 0);
		for (const name of names) {
			const source = readFileSync(resolve(root,name),'utf8');
			const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
			assert.ok(match,`${name} must contain YAML frontmatter`);
			assert.deepEqual(validateAgentDefinitionModel(parseYaml(match[1])).diagnostics,[],name);
		}
	});
});
