import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

const digest = `sha256:${'b'.repeat(64)}`;
const plan = { schemaVersion: 'treeseed.platform-project-create-plan/v1', slug: 'example-app', template: { id: 'engineering', version: '1.0.0-rc.5', digest }, team: 'team-1',
	repository: { owner: 'example', name: 'example-app', visibility: 'private' }, steps: ['project', 'repository', 'template', 'library', 'inventory'],
	actions: ['project', 'repository', 'template', 'library', 'inventory'].map((step, index) => ({ step, action: ['create', 'adopt', 'apply', 'bind', 'publish'][index] })),
	observationDigest: digest, planDigest: digest, ok: true, blockers: [] };

function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-project-create-')); mkdirSync(resolve(root, 'templates'));
	writeFileSync(resolve(root, 'templates/engineering.yaml'), `schemaVersion: treeseed.platform-template-lock/v1\nid: engineering\nversion: 1.0.0-rc.5\nartifact:\n  digest: ${digest}\n`);
	return root;
}

test('platform project create plans through API authority without mutation', async () => {
	const root = fixture(); const calls: any[] = []; const output: string[] = [];
	try {
		const exit = await runCommandLine(['platform', 'project', 'create', 'example-app', '--template', 'engineering', '--plan', '--json'], {
			cwd: root, env: { TREESEED_TEAM_ID: 'team-1' }, interactiveUi: false, write: (value) => output.push(value),
			operationInvoke: async (operationId, input, options) => { calls.push({ operationId, input, options }); return { data: plan }; },
		});
		assert.equal(exit, 0, output.join('\n')); assert.equal(calls.length, 1); assert.equal(calls[0].input.body.mode, 'plan');
		assert.match(calls[0].options.idempotencyKey, /^[0-9a-f-]{36}$/u);
		assert.equal(JSON.parse(output[0]!).result.planDigest, digest);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('platform project create applies the exact API plan and never writes application source locally', async () => {
	const root = fixture(); const calls: any[] = []; const output: string[] = [];
	try {
		const exit = await runCommandLine(['platform', 'project', 'create', 'example-app', '--template', 'engineering', '--apply', '--yes', '--json'], {
			cwd: root, env: { TREESEED_TEAM_ID: 'team-1' }, interactiveUi: false, write: (value) => output.push(value),
			operationInvoke: async (operationId, input: any, options) => { calls.push({ operationId, input, options }); return input.body.mode === 'plan' ? { data: plan } : { data: { ...plan, schemaVersion: 'treeseed.platform-project-create-receipt/v1', projectId: 'project-1' } }; },
		});
		assert.equal(exit, 0, output.join('\n')); assert.deepEqual(calls.map((call) => call.input.body.mode), ['plan', 'apply']);
		assert.equal(calls.every((call) => /^[0-9a-f-]{36}$/u.test(call.options.idempotencyKey)), true);
		assert.notEqual(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey);
		assert.equal(calls[1].input.body.plan.planDigest, digest); assert.equal(JSON.parse(output[0]!).result.projectId, 'project-1');
		assert.equal(await import('node:fs').then(({ existsSync }) => existsSync(resolve(root, 'packages/example-app'))), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
