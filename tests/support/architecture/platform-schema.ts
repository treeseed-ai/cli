import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';

type Schema = { $defs: Record<string, unknown>; oneOf: { $ref: string }[] };
const schemaPath = 'docs/agent.schema.yml';
export function platformSchemaFixture() {
	const workspace = process.env.TREESEED_DEVELOPMENT_WORKSPACE_ROOT;
	assert.ok(workspace, 'Missing declared canonical workspace blocks architecture coverage');
	const authority = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
	const bytes = execFileSync('git', ['show', `${authority}:${schemaPath}`], { cwd: workspace, encoding: 'utf8' });
	assert.equal(readFileSync(resolve(workspace, schemaPath), 'utf8'), bytes, 'Canonical input must match exact tracked Git bytes');
	const document = parse(bytes) as Schema;
	assert.ok(document.$defs && document.oneOf.length, 'Complete canonical target required');
	const root = mkdtempSync(resolve(tmpdir(), 'cli-architecture-schema-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	try {
		mkdirSync(resolve(root, 'docs'));
		mkdirSync(resolve(root, 'seeds'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'development:\n  local:\n    inventory: { source: seed, path: seeds/inventory.yaml }\n');
		writeFileSync(resolve(root, 'seeds/inventory.yaml'), 'schemaVersion: treeseed.seed-bundle/v3\nresources: { projects: [], repositories: [] }\n');
		writeFileSync(resolve(root, schemaPath), bytes);
		git('init', '--quiet');
		git('add', '.');
		git('-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test', 'commit', '--quiet', '-m', 'Exact canonical input');
	} catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
	return { root, document, bytes, git,
		commit(value: Schema) {
			writeFileSync(resolve(root, schemaPath), stringify(value));
			git('add', schemaPath);
			git('-c', 'user.name=Architecture test', '-c', 'user.email=architecture@example.test', 'commit', '--quiet', '-m', 'Changed declaration');
		},
		close() {
			try {
				assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), authority);
				assert.equal(readFileSync(resolve(workspace, schemaPath), 'utf8'), bytes);
			} finally { rmSync(root, { recursive: true, force: true }); }
		},
	};
}
