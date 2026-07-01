import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const { runTreeseedCli } = await import('../dist/cli/main.js');

async function runCli(args, cwd) {
	const writes = [];
	const exitCode = await runTreeseedCli(args, {
		cwd,
		env: { ...process.env, GITHUB_ACTIONS: undefined, CI: undefined },
		interactiveUi: false,
		write(output, stream) {
			writes.push({ output, stream });
		},
		spawn() {
			return { status: 0 };
		},
	});
	const output = writes.map((entry) => entry.output).join('\n');
	return { exitCode, output };
}

function parseJsonOutput(output) {
	const start = output.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${output}`);
	return JSON.parse(output.slice(start));
}

function makeWorkspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-guarantees-'));
	mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'scenes'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), 'id: fixture\n');
	writeFileSync(resolve(root, 'packages', 'admin', 'package.json'), JSON.stringify({ name: '@treeseed/admin' }));
	writeFileSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'ask-question.guarantee.yaml'), `schemaVersion: treeseed.guarantee/v1
id: guarantee.project.question.ask-question.038
journeyIndex: 38
type: project
subtype: question
journey: Ask Question
ownerPackage: "@treeseed/admin"
summary: Ask a project question.
status: planned
dependencies: { journeys: [], guarantees: [] }
actors: { allowed: [project_contributor], forbidden: [project_viewer] }
devices: { required: [desktop_chromium] }
gates: [core, release]
preconditions: { fixtures: [project] }
scene:
  required: true
  manifest: ./scenes/ask-question.scene.yaml
api:
  required: true
  verifierRefs: [todo.project.question.ask-question.api]
evidence:
  required: [playwright_trace]
`, 'utf8');
	writeFileSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'scenes', 'ask-question.scene.yaml'), 'schemaVersion: treeseed.scene/v1\nid: ask-question\n');
	return root;
}

test('guarantees validate emits structured filtered result', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'validate', '--type', 'project', '--subtype', 'question', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees validate');
	assert.equal(payload.ok, true);
	assert.equal(payload.counts.selected, 1);
});

test('guarantees rejects mixed-case taxonomy filters', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'plan', '--type', 'Project', '--json'], root);
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.ok, false);
	assert.equal(payload.diagnostics[0].code, 'guarantees.invalid_filter');
});

test('guarantees export writes generated CSV only when output is explicit', async () => {
	const root = makeWorkspace();
	const output = resolve(root, '.treeseed', 'generated', 'guarantees.csv');
	const result = await runCli(['guarantees', 'export', '--format', 'csv', '--output', output, '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees export');
	assert.equal(payload.outputPath, output);
});

test('guarantees run emits skipped planned entries when requested', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'run', '--type', 'project', '--subtype', 'question', '--include-planned', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees run');
	assert.equal(payload.ok, true);
	assert.equal(payload.counts.planned, 1);
	assert.equal(payload.counts.skipped, 1);
});
