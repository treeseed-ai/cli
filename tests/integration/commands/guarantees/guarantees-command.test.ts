import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const { runCommandLine } = await import('../../../../dist/cli/main.js');
const { ensureLocalDevForGuaranteeRun } = await import('../../../../dist/cli/handlers/guarantees/guarantees.js');

async function runCli(args, cwd, env = {}) {
	const writes = [];
	const spawns = [];
	const exitCode = await runCommandLine(args, {
		cwd,
		env: { ...process.env, ...env, GITHUB_ACTIONS: undefined, CI: undefined },
		interactiveUi: false,
		write(output, stream) {
			writes.push({ output, stream });
		},
		spawn(command, args, options) {
			spawns.push({ command, args, options });
			return { status: 0 };
		},
	});
	const output = writes.map((entry) => entry.output).join('\n');
	return { exitCode, output, spawns };
}

function parseJsonOutput(output) {
	const start = output.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${output}`);
	return JSON.parse(output.slice(start));
}

function makeWorkspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-guarantees-'));
	mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'scenes'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'admin', 'guarantees', 'verifiers'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market' }));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), 'id: fixture\n');
	writeFileSync(resolve(root, 'packages', 'admin', 'package.json'), JSON.stringify({ name: '@treeseed/admin' }));
	writeFileSync(resolve(root, 'packages', 'admin', 'guarantees', 'verifiers', 'admin.verifiers.yaml'), `schemaVersion: treeseed.guarantee-verifiers/v1
ownerPackage: "@treeseed/admin"
verifiers:
  fixture.project.question.api:
    kind: manualEvidence
    ownerPackage: "@treeseed/admin"
    evidence:
      - fixture/manual-evidence.json
`, 'utf8');
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

function activateQuestionGuarantee(root) {
	writeFileSync(resolve(root, 'packages', 'admin', 'guarantees', 'project', 'question', 'ask-question.guarantee.yaml'), `schemaVersion: treeseed.guarantee/v1
id: guarantee.project.question.ask-question.038
journeyIndex: 38
type: project
subtype: question
journey: Ask Question
ownerPackage: "@treeseed/admin"
summary: Ask a project question.
status: active
dependencies: { journeys: [], guarantees: [] }
actors: { allowed: [project_contributor], forbidden: [project_viewer] }
devices: { required: [desktop_chromium] }
gates: [core]
preconditions: { fixtures: [project] }
api:
  required: true
  verifierRefs: [fixture.project.question.api]
negativeCases:
  - id: missing-question-permission
    verifierRefs: [fixture.project.question.api]
evidence:
  required: [manual_evidence]
`, 'utf8');
}

function addAgentCatalogGuarantee(root) {
	const directory = resolve(root, 'guarantees', 'agent', 'profile');
	mkdirSync(directory, { recursive: true });
	writeFileSync(resolve(directory, 'planning.guarantee.yaml'), `schemaVersion: treeseed.guarantee/v2
id: guarantee.agent.profile.planning.901
journeyIndex: 901
type: agent
subtype: profile
journey: Prove planning
ownerPackage: "@treeseed/market"
summary: Prove exact planning output.
status: planned
capabilityId: agent.profile.planning
catalog: agent.system
activation: { minimumConsecutivePasses: 3, requiredVariants: [baseline, clean-repeat, interruption-resume], invalidateOnSourceChange: true }
proof:
  requiredCommands: [capacity.assignment]
  minimumRepositoryPostconditions: 0
  outcomePredicates:
    planning.output: [planning.model]
outcomes:
  - id: planning.output
    kind: required
    description: Exact planning output exists.
    evidenceKinds: [content_read_back]
    authoritativeSubjects: [assignment]
dependencies: { journeys: [], guarantees: [] }
actors: { allowed: [operator], forbidden: [] }
devices: { required: [] }
gates: [core]
preconditions: { fixtures: [] }
api: { required: false, verifierRefs: [] }
content: { required: false, verifierRefs: [] }
audit: { required: false, verifierRefs: [] }
negativeCases: []
evidence: { required: [verifier_evidence] }
`);
}

test('guarantees validate emits structured filtered result', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'validate', '--type', 'project', '--subtype', 'question', '--json'], root);
	assert.equal(result.exitCode, 0, result.output);
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

test('guarantees audit-journeys emits scene-backed journey report', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'audit-journeys', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees audit-journeys');
	assert.equal(payload.schemaVersion, 'treeseed.guarantee-journey-audit/v1');
	assert.equal(payload.totals.sceneBacked, 1);
	assert.equal(payload.totals.activeSceneBackedWeak, 0);
});

test('guarantees audit-journeys writes explicit report output', async () => {
	const root = makeWorkspace();
	const output = resolve(root, '.treeseed', 'guarantees', 'audit', 'journeys.json');
	const result = await runCli(['guarantees', 'audit-journeys', '--write-report', output, '--json'], root);
	assert.equal(result.exitCode, 0);
	assert.equal(existsSync(output), true);
	const payload = parseJsonOutput(result.output);
	const written = JSON.parse(readFileSync(output, 'utf8'));
	assert.equal(payload.command, 'guarantees audit-journeys');
	assert.equal(payload.reportPath, output);
	assert.equal(written.schemaVersion, 'treeseed.guarantee-journey-audit/v1');
	assert.equal(written.totals.sceneBacked, 1);
});

test('guarantees run emits skipped planned entries when requested', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'run', '--type', 'project', '--subtype', 'question', '--include-planned', '--json'], root);
	assert.equal(result.exitCode, 0, result.output);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees run');
	assert.equal(payload.ok, true);
	assert.equal(payload.counts.planned, 1);
	assert.equal(payload.counts.skipped, 1);
	assert.equal(result.spawns.length, 0);
});

test('guarantees catalog-status exposes machine-readable activation counts', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'catalog-status', '--json'], root);
	assert.equal(result.exitCode, 0, result.output);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees catalog-status');
	assert.equal(payload.schemaVersion, 'treeseed.agent-guarantee-catalog-status/v1');
	assert.deepEqual(payload.counts, { total: 0, broken: 0, blocked: 0, passing: 0, active: 0 });
});

test('candidate proof requires an explicit activation variant', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'run', '--prove-planned', '--json'], root);
	assert.equal(result.exitCode, 1, result.output);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.error, 'guarantee_variant_required');
});

test('agent proof input is accepted only for a planned activation candidate', async () => {
	const root = makeWorkspace();
	const result = await runCli(['guarantees', 'run', '--proof-input', '.treeseed/proof.json', '--json'], root);
	assert.equal(result.exitCode, 1, result.output);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.error, 'guarantee_proof_input_without_candidate');
});

test('agent proof template exposes every required predicate and fails closed until resolved', async () => {
	const root = makeWorkspace(); addAgentCatalogGuarantee(root);
	const output = '.treeseed/guarantees/inputs/planning.json';
	const created = await runCli(['guarantees', 'proof-template', '--id', 'guarantee.agent.profile.planning.901', '--variant', 'baseline', '--output', output, '--json'], root);
	assert.equal(created.exitCode, 0, created.output);
	const createPayload = parseJsonOutput(created.output);
	assert.equal(createPayload.ready, false);
	assert.deepEqual(createPayload.outcomePredicates['planning.output'], ['planning.model']);
	const validated = await runCli(['guarantees', 'proof-validate', '--id', 'guarantee.agent.profile.planning.901', '--variant', 'baseline', '--proof-input', output, '--json'], root);
	assert.equal(validated.exitCode, 1, validated.output);
	const validatePayload = parseJsonOutput(validated.output);
	assert.equal(validatePayload.ok, false);
	assert.match(validatePayload.issues.join('\n'), /unresolved placeholder/u);
});

test('guarantee preflight verifies managed source closure even when endpoints may already be healthy', async () => {
	const root = makeWorkspace();
	activateQuestionGuarantee(root);
	const calls = [];
	const result = await ensureLocalDevForGuaranteeRun({ cwd: root, env: { ...process.env } }, {
		filter: { type: 'project', subtype: 'question' },
	}, async (options) => {
		calls.push(options);
		return { ok: true, action: 'start', plan: { processes: [] }, instances: [] };
	});
	assert.equal(result.ok, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].action, 'start');
	assert.equal(calls[0].force, false);
	assert.equal(calls[0].forceConflicts, true);
});

test('agent guarantees live-codex mode fails closed when Codex auth is missing', async () => {
	const root = makeWorkspace();
	const home = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-no-codex-auth-'));
	const result = await runCli(['guarantees', 'run', '--owner-package', '@treeseed/agent', '--json'], root, {
		HOME: home,
		TREESEED_AGENT_GUARANTEE_EXECUTION_PROVIDER: 'live-codex',
		TREESEED_CODEX_AUTH_FILE: '',
		CODEX_AUTH_FILE: '',
	});
	assert.equal(result.exitCode, 1);
	assert.equal(result.spawns.length, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'guarantees run');
	assert.equal(payload.ok, false);
	assert.equal(payload.error, 'missing_codex_auth');
	assert.equal(payload.diagnostics[0].code, 'guarantees.missing_codex_auth');
});
