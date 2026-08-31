import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { runCommandLine } from '../../../../src/cli/runtime.ts';

const capture = () => { const output: string[] = []; return { output, write: (value: string) => output.push(value) }; };

test('platform verify works from a clean declarative clone without packages or an API', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-cli-'));
	try {
		execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
		mkdirSync(resolve(root, 'seeds'));
		writeFileSync(resolve(root, 'README.md'), '# Portable Platform\n');
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'development:\n  local:\n    inventory: { source: seed, path: seeds/inventory.yaml }\n');
		writeFileSync(resolve(root, 'seeds/inventory.yaml'), 'schemaVersion: treeseed.seed-bundle/v3\nresources:\n  projects: []\n  repositories: []\n');
		execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
		const target = capture();
		assert.equal(await runCommandLine(['platform', 'verify', '--json'], { cwd: root, interactiveUi: false, write: target.write }), 0, target.output.join('\n'));
		const envelope = JSON.parse(target.output[0]!);
		assert.equal(envelope.result.ok, true);
		assert.equal(envelope.result.profiles.length, 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('platform verify preserves local policy diagnostics instead of masking them as a control-plane rejection', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-cli-'));
	try {
		execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
		writeFileSync(resolve(root, 'package.json'), '{}\n');
		execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
		const target = capture();
		assert.equal(await runCommandLine(['platform', 'verify', '--json'], { cwd: root, interactiveUi: false, write: target.write }), 1);
		const envelope = JSON.parse(target.output[0]!);
		assert.equal(envelope.error.code, 'platform_verification_failed');
		assert.equal(envelope.result.diagnostics[0].code, 'content_root_forbidden');
		assert.notEqual(envelope.error.code, 'control_plane_rejected');
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('platform workset plans and applies an exact local staging checkout', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-cli-'));
	const source = mkdtempSync(resolve(tmpdir(), 'platform-source-'));
	try {
		execFileSync('git', ['init', '-b', 'staging'], { cwd: source, stdio: 'ignore' });
		execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: source });
		execFileSync('git', ['config', 'user.name', 'Test'], { cwd: source });
		writeFileSync(resolve(source, 'README.md'), '# SDK\n');
		execFileSync('git', ['add', '.'], { cwd: source });
		execFileSync('git', ['commit', '-m', 'initial'], { cwd: source, stdio: 'ignore' });
		mkdirSync(resolve(root, 'seeds'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'development:\n  local:\n    inventory: { source: seed, path: seeds/inventory.yaml }\n');
		writeFileSync(resolve(root, 'seeds/inventory.yaml'), `schemaVersion: treeseed.seed-bundle/v3\nresources:\n  projects:\n    - { key: project:sdk, slug: sdk, primaryRepository: repository:sdk }\n  repositories:\n    - { key: repository:sdk, project: project:sdk, role: primary, gitUrl: ${source}, defaultBranch: main, repositoryPolicy: { stagingBranch: staging } }\n`);
		const planned = capture();
		assert.equal(await runCommandLine(['platform', 'workset', '--plan', '--project', 'sdk', '--json'], { cwd: root, interactiveUi: false, write: planned.write }), 0);
		assert.equal(JSON.parse(planned.output[0]!).result.entries[0].action, 'clone');
		const applied = capture();
		assert.equal(await runCommandLine(['platform', 'workset', '--apply', '--yes', '--project', 'sdk', '--json'], { cwd: root, interactiveUi: false, write: applied.write }), 0, applied.output.join('\n'));
		assert.equal(JSON.parse(applied.output[0]!).result.entries[0].action, 'clone');
		const replay = capture();
		assert.equal(await runCommandLine(['platform', 'workset', '--plan', '--project', 'sdk', '--json'], { cwd: root, interactiveUi: false, write: replay.write }), 0);
		assert.equal(JSON.parse(replay.output[0]!).result.entries[0].action, 'noop');
	} finally { rmSync(root, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); }
});
