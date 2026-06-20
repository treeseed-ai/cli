import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const { runTreeseedCli } = await import('../dist/cli/main.js');

async function runCli(args, cwd = process.cwd()) {
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
	return { exitCode, output, writes };
}

function makeWorkspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-scenes-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	writeFileSync(resolve(root, 'scenes', 'market-project-deploy-demo.yaml'), `schemaVersion: treeseed.scene/v1
id: market-project-deploy-demo
title: Market Project Deployment Demo
target:
  app: market
workflow:
  - id: open-projects
    title: Open projects
    action:
      goto: /app/projects
    expect:
      visible:
        - scene: projects.index
`, 'utf8');
	writeFileSync(resolve(root, 'scenes', 'invalid-demo.yaml'), `schemaVersion: treeseed.scene/v1
id: invalid-demo
title: Invalid Demo
target:
  app: market
workflow:
  - id: open
    title: Open
    action:
      goto: /
`, 'utf8');
	return root;
}

function parseJsonOutput(output) {
	const start = output.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${output}`);
	return JSON.parse(output.slice(start));
}

function parseJsonLines(output) {
	return output
		.split(/\n+/u)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line));
}

function writeInspectableRun(root) {
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	writeFileSync(resolve(root, 'scenes', 'inspect-demo.yaml'), `schemaVersion: treeseed.scene/v1
id: inspect-demo
title: Inspect Demo
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
chapters:
  - id: intro
    title: Intro
    startsAt: open
`, 'utf8');
	const runRoot = resolve(root, '.treeseed', 'scenes', 'runs', 'inspect-demo', '20260614T120000Z-inspect');
	mkdirSync(resolve(runRoot, 'checkpoints'), { recursive: true });
	const run = {
		ok: false,
		phase: 5,
		sceneId: 'inspect-demo',
		runId: 'inspect',
		scenePath: 'scenes/inspect-demo.yaml',
		startedAt: '2026-06-14T12:00:00.000Z',
		finishedAt: '2026-06-14T12:00:01.000Z',
		durationMs: 1000,
		environment: 'local',
		baseUrl: 'http://example.test',
		browser: 'chromium',
		workflowStatus: 'failed',
		steps: [{ id: 'open', title: 'Open', actionKind: 'goto', startedAt: '2026-06-14T12:00:00.000Z', finishedAt: '2026-06-14T12:00:01.000Z', durationMs: 1000, status: 'failed', retryCount: 0, assertionResults: [], screenshotPath: null, traceLocation: null, consoleErrors: [], networkErrors: [], operationIds: [] }],
		failedStep: 'open',
		assertions: [],
		artifacts: { runRoot, normalizedScenePath: resolve(runRoot, 'scene.normalized.json'), planPath: resolve(runRoot, 'scene.plan.json'), runPath: resolve(runRoot, 'run.json'), timelinePath: resolve(runRoot, 'timeline.json'), markdownReportPath: resolve(runRoot, 'report.md'), playwrightTracePath: null, screenshotPaths: [], videoPaths: [], consoleLogPath: null, networkLogPath: null, errorsLogPath: null, progressPath: resolve(runRoot, 'progress.jsonl'), checkpointsRoot: resolve(runRoot, 'checkpoints') },
		timelinePath: resolve(runRoot, 'timeline.json'),
		playwrightTracePath: null,
		videoPaths: [],
		renderedVideoPaths: [],
		logs: {},
		setup: null,
		operations: [],
		chapters: [],
		segments: [],
		checkpoints: [],
		progressPath: resolve(runRoot, 'progress.jsonl'),
		warnings: [],
		blockers: [],
		diagnostics: [],
	};
	writeFileSync(resolve(runRoot, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
	writeFileSync(resolve(runRoot, 'timeline.json'), '[]\n', 'utf8');
	writeFileSync(resolve(runRoot, 'report.md'), '# Inspect Demo\n', 'utf8');
	writeFileSync(resolve(runRoot, 'scene.normalized.json'), JSON.stringify({ schemaVersion: 'treeseed.scene/v1', id: 'inspect-demo', title: 'Inspect Demo', audience: [], mode: { test: true, demo: false, training: false }, target: { app: 'market', environment: 'local', baseUrl: 'http://example.test', viewport: { width: 1440, height: 1000 }, browser: 'chromium' }, setup: {}, artifacts: { trace: true, video: false, screenshots: true, console: true, network: true, timeline: true, appLogs: true }, workflow: [], chapters: [], overlays: [], diagrams: [], render: {}, runtime: { mode: 'acceptance', timeouts: { sceneSeconds: null, chapterSeconds: null, stepSeconds: 120 }, checkpoints: { enabled: true, defaultResumable: false, everyStep: true }, progress: { heartbeatSeconds: 15 }, failure: { continueOnFailure: false } } }, null, 2), 'utf8');
	writeFileSync(resolve(runRoot, 'checkpoints', 'open.json'), JSON.stringify({ id: 'open', sceneId: 'inspect-demo', runId: 'inspect', stepId: 'open', chapterId: 'default', segmentId: 'default-segment-001', createdAt: '2026-06-14T12:00:01.000Z', resumable: false, completedStepIds: ['open'], nextStepId: null, artifactPaths: { checkpointPath: resolve(runRoot, 'checkpoints', 'open.json'), runRoot, timelinePath: resolve(runRoot, 'timeline.json'), reportPath: resolve(runRoot, 'report.md') } }, null, 2), 'utf8');
	return runRoot;
}

test('scene status reports Phase 0 foundation readiness as JSON', async () => {
	const result = await runCli(['scene', 'status', '--json']);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene');
	assert.equal(payload.ok, true);
	assert.equal(payload.phase, 0);
	assert.equal(payload.status, 'foundation_ready');
	assert.equal(payload.name, 'central TreeSeed acceptance test harness and demo / educational video generator');
	assert.deepEqual(payload.deferredDependencies, []);
	assert.deepEqual(payload.activeOptionalDependencies, ['remotion', '@remotion/renderer', '@remotion/bundler']);
	assert.equal(payload.nextPhase.phase, 12);
});

test('scene defaults to status', async () => {
	const result = await runCli(['scene', '--json']);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene');
	assert.equal(payload.status, 'foundation_ready');
});

test('scene rejects unsupported Phase 11 actions', async () => {
	const result = await runCli(['scene', 'unknown', '--json']);
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene');
	assert.equal(payload.ok, false);
	assert.match(payload.error, /Phase 11 supports status, validate, plan, run, inspect, resume, render, training, evidence, publish, publish-plan, export, and visual-audit/u);
});

test('scene help describes the command surface', async () => {
	const result = await runCli(['help', 'scene']);
	assert.equal(result.exitCode, 0);
	assert.match(result.output, /treeseed scene \[status\] \[--json\]/u);
	assert.match(result.output, /central TreeSeed acceptance test harness/u);
	assert.match(result.output, /diagram-only/u);
	assert.match(result.output, /scene training/u);
	assert.match(result.output, /scene evidence/u);
	assert.match(result.output, /scene publish/u);
	assert.match(result.output, /scene publish-plan/u);
	assert.match(result.output, /scene export/u);
	assert.match(result.output, /scene visual-audit/u);
	assert.match(result.output, /--device <profile\|all>/u);
	assert.match(result.output, /--device desktop/u);
	assert.match(result.output, /--device tablet/u);
	assert.match(result.output, /--device mobile/u);
	assert.match(result.output, /--roles <roles>/u);
	assert.match(result.output, /--path-root <roots>/u);
	assert.match(result.output, /--path <globs>/u);
	assert.match(result.output, /--exclude-path <globs>/u);
	assert.match(result.output, /--full-page/u);
	assert.match(result.output, /--review/u);
	assert.match(result.output, /--no-review/u);
	assert.match(result.output, /--review-detail <detail>/u);
	assert.match(result.output, /--max-findings <n>/u);
});

test('scene validate passes for a valid manifest', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'validate', 'scenes/market-project-deploy-demo.yaml', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene validate');
	assert.equal(payload.ok, true);
	assert.equal(payload.scene.id, 'market-project-deploy-demo');
});

test('scene validate fails for an invalid manifest', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'validate', 'scenes/invalid-demo.yaml', '--json'], root);
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene validate');
	assert.equal(payload.ok, false);
	assert.ok(payload.diagnostics.some((entry) => entry.code === 'scene.missing_assertion'));
});

test('scene plan emits deterministic plan shape', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'plan', 'scenes/market-project-deploy-demo.yaml', '--environment', 'local', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene plan');
	assert.equal(payload.ok, true);
	assert.equal(payload.phase, 1);
	assert.equal(payload.sceneId, 'market-project-deploy-demo');
	assert.equal(payload.environment, 'local');
	assert.equal(payload.workflowSteps[0].actionKind, 'goto');
	assert.deepEqual(payload.enabledActions, ['goto']);
	assert.deepEqual(payload.enabledAssertions, ['visible']);
	assert.ok(Array.isArray(payload.plugins));
	assert.ok(payload.plugins.some((entry) => entry.id === 'treeseed.scene.browser-actions'));
	assert.deepEqual(payload.enabledTrainingOutputs, ['captions', 'transcript', 'narration', 'glossary', 'chapter-clips']);
	assert.deepEqual(payload.enabledPlugins.sort(), ['treeseed.scene.browser-actions', 'treeseed.scene.browser-assertions', 'treeseed.scene.training.deterministic']);
	assert.deepEqual(payload.pluginDiagnostics, []);
	assert.ok(payload.artifactPaths.runRoot.includes('.treeseed/scenes/runs/market-project-deploy-demo/'));
});

test('scene plan resolves bare scene ids and supports environment override', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'plan', 'market-project-deploy-demo', '--environment', 'prod', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.environment, 'prod');
	assert.match(payload.scenePath, /scenes\/market-project-deploy-demo\.yaml$/u);
});

test('scene validate and plan require a scene argument', async () => {
	const validateResult = await runCli(['scene', 'validate', '--json']);
	assert.equal(validateResult.exitCode, 1);
	assert.equal(parseJsonOutput(validateResult.output).error, 'Missing scene manifest path.');
	const planResult = await runCli(['scene', 'plan', '--json']);
	assert.equal(planResult.exitCode, 1);
	assert.equal(parseJsonOutput(planResult.output).error, 'Missing scene manifest path.');
});

test('scene run requires a scene argument', async () => {
	const result = await runCli(['scene', 'run', '--json']);
	assert.equal(result.exitCode, 1);
	assert.equal(parseJsonOutput(result.output).error, 'Missing scene manifest path.');
});

test('scene run invalid yaml returns structured diagnostics', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'run', 'scenes/invalid-demo.yaml', '--json'], root);
	assert.equal(result.exitCode, 1);
	const final = parseJsonLines(result.output).at(-1);
	assert.equal(final.command, 'scene run');
	assert.equal(final.kind, 'final');
	assert.equal(final.report.workflowStatus, 'blocked');
	assert.ok(final.report.diagnostics.some((entry) => entry.code === 'scene.missing_assertion'));
});

test('scene run reports unknown device before browser launch', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'run', 'market-project-deploy-demo', '--device', 'watch', '--json'], root);
	assert.equal(result.exitCode, 1);
	const final = parseJsonLines(result.output).at(-1);
	assert.equal(final.command, 'scene run');
	assert.equal(final.kind, 'final');
	assert.ok(final.report.diagnostics.some((entry) => entry.code === 'scene.device_unknown'));
});

test('scene run with auto base url reports local dev not running without launching browser', async () => {
	const root = makeWorkspace();
	const result = await runCli(['scene', 'run', 'market-project-deploy-demo', '--environment', 'local', '--json'], root);
	assert.equal(result.exitCode, 1);
	const lines = parseJsonLines(result.output);
	assert.ok(lines.some((entry) => entry.kind === 'event'));
	const final = lines.at(-1);
	assert.equal(final.command, 'scene run');
	assert.equal(final.kind, 'final');
	assert.equal(final.report.workflowStatus, 'blocked');
	assert.ok(final.report.setup);
	assert.ok(final.report.diagnostics.some((entry) => entry.code === 'scene.local_dev_not_running'));
});

test('scene visual-audit validates arguments and dispatches through scene command', async () => {
	const missingScene = await runCli(['scene', 'visual-audit', '--json']);
	assert.equal(missingScene.exitCode, 1);
	assert.equal(parseJsonOutput(missingScene.output).error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const invalidDetail = await runCli(['scene', 'visual-audit', 'market-project-deploy-demo', '--review-detail', 'verbose', '--json'], root);
	assert.equal(invalidDetail.exitCode, 1);
	assert.ok(parseJsonOutput(invalidDetail.output).diagnostics.some((entry) => entry.code === 'scene.visual_audit_invalid_review_detail'));

	const invalidMax = await runCli(['scene', 'visual-audit', 'market-project-deploy-demo', '--max-findings', '0', '--json'], root);
	assert.equal(invalidMax.exitCode, 1);
	assert.ok(parseJsonOutput(invalidMax.output).diagnostics.some((entry) => entry.code === 'scene.visual_audit_invalid_max_findings'));

	const result = await runCli([
		'scene',
		'visual-audit',
		'market-project-deploy-demo',
		'--environment',
		'local',
		'--roles',
		'anonymous',
		'--device',
		'desktop',
		'--path-root',
		'/auth',
		'--path',
		'/auth/**,**/register',
		'--exclude-path',
		'**/callback',
		'--review-detail',
		'full',
		'--max-findings',
		'25',
		'--json',
	], root);
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene visual-audit');
	assert.equal(payload.phase, 11);
	assert.deepEqual(payload.roles, ['anonymous']);
	assert.deepEqual(payload.devices, ['desktop']);
	assert.equal(payload.reviewFindingCount, 0);
	assert.equal(payload.clientErrorCount, 0);
	assert.ok(payload.diagnostics.some((entry) => entry.code === 'scene.local_dev_not_running'));
});

test('scene inspect reads run artifacts and selected step', async () => {
	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const result = await runCli(['scene', 'inspect', runRoot, '--step', 'open', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene inspect');
	assert.equal(payload.selectedStep.id, 'open');
	assert.equal(payload.run.runId, 'inspect');
});

test('scene resume requires checkpoint and rejects non-resumable checkpoints', async () => {
	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missing = await runCli(['scene', 'resume', runRoot, '--json'], root);
	assert.equal(missing.exitCode, 1);
	assert.equal(parseJsonOutput(missing.output).error, 'Missing checkpoint id.');
	const result = await runCli(['scene', 'resume', runRoot, '--from-checkpoint', 'open', '--json'], root);
	assert.equal(result.exitCode, 1);
	const final = parseJsonLines(result.output).at(-1);
	assert.equal(final.kind, 'final');
	assert.equal(final.report.diagnostics[0].code, 'scene.checkpoint_not_resumable');
});

test('scene render validates arguments and source artifacts', async () => {
	const result = await runCli(['scene', 'render', '--json']);
	assert.equal(result.exitCode, 1);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene render');
	assert.equal(payload.ok, false);
	assert.equal(payload.error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missingFrom = await runCli(['scene', 'render', 'inspect-demo', '--json'], root);
	assert.equal(missingFrom.exitCode, 1);
	assert.equal(parseJsonOutput(missingFrom.output).error, 'Missing source run id or path.');

	const unknownRenderer = await runCli(['scene', 'render', 'inspect-demo', '--from', runRoot, '--renderer', 'unknown', '--json'], root);
	assert.equal(unknownRenderer.exitCode, 1);
	assert.equal(parseJsonOutput(unknownRenderer.output).diagnostics[0].code, 'scene.renderer_unknown');

	const badFormat = await runCli(['scene', 'render', 'inspect-demo', '--from', runRoot, '--format', 'webm', '--json'], root);
	assert.equal(badFormat.exitCode, 1);
	assert.equal(parseJsonOutput(badFormat.output).diagnostics[0].code, 'scene.render_format_unsupported');

	const missingMedia = await runCli(['scene', 'render', 'inspect-demo', '--from', runRoot, '--mode', 'failure-review', '--json'], root);
	assert.equal(missingMedia.exitCode, 1);
	const missingMediaPayload = parseJsonOutput(missingMedia.output);
	assert.equal(missingMediaPayload.command, 'scene render');
	assert.equal(missingMediaPayload.phase, 6);
	assert.equal(missingMediaPayload.mode, 'failure-review');
	assert.ok(missingMediaPayload.diagnostics.some((entry) => entry.code === 'scene.render_missing_media'));

	const missingChapter = await runCli(['scene', 'render', 'inspect-demo', '--from', runRoot, '--mode', 'chapter', '--chapter', 'missing', '--json'], root);
	assert.equal(missingChapter.exitCode, 1);
	assert.ok(parseJsonOutput(missingChapter.output).diagnostics.some((entry) => entry.code === 'scene.render_chapter_not_found'));

	const missingDiagram = await runCli(['scene', 'render', 'inspect-demo', '--from', runRoot, '--mode', 'diagram-only', '--json'], root);
	assert.equal(missingDiagram.exitCode, 1);
	assert.ok(parseJsonOutput(missingDiagram.output).diagnostics.some((entry) => entry.code === 'scene.render_missing_diagram'));
});

test('scene training validates arguments and writes deterministic outputs', async () => {
	const missingScene = await runCli(['scene', 'training', '--json']);
	assert.equal(missingScene.exitCode, 1);
	assert.equal(parseJsonOutput(missingScene.output).error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missingFrom = await runCli(['scene', 'training', 'inspect-demo', '--json'], root);
	assert.equal(missingFrom.exitCode, 1);
	assert.equal(parseJsonOutput(missingFrom.output).error, 'Missing source run id or path.');

	const missingRun = await runCli(['scene', 'training', 'inspect-demo', '--from', 'missing', '--json'], root);
	assert.equal(missingRun.exitCode, 1);
	assert.ok(parseJsonOutput(missingRun.output).diagnostics.some((entry) => entry.code === 'scene.run_not_found'));

	const result = await runCli(['scene', 'training', 'inspect-demo', '--from', runRoot, '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene training');
	assert.equal(payload.phase, 8);
	assert.equal(payload.sceneId, 'inspect-demo');
	assert.ok(payload.paths.captionsVttPath);
	assert.ok(payload.paths.transcriptMarkdownPath);
	assert.ok(payload.paths.chapterClipsPath);
	const updatedRun = JSON.parse(readFileSync(resolve(runRoot, 'run.json'), 'utf8'));
	assert.equal(updatedRun.trainingOutputPaths.trainingRoot, payload.trainingRoot);

	const vttOnly = await runCli(['scene', 'training', 'inspect-demo', '--from', runRoot, '--format', 'vtt', '--json'], root);
	assert.equal(vttOnly.exitCode, 0);
	const vttPayload = parseJsonOutput(vttOnly.output);
	assert.ok(vttPayload.paths.captionsVttPath);
	assert.equal(vttPayload.paths.captionsSrtPath, null);
	assert.equal(vttPayload.paths.transcriptJsonPath, null);
});

test('scene evidence validates arguments and writes a sanitized bundle', async () => {
	const missingScene = await runCli(['scene', 'evidence', '--json']);
	assert.equal(missingScene.exitCode, 1);
	assert.equal(parseJsonOutput(missingScene.output).error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missingFrom = await runCli(['scene', 'evidence', 'inspect-demo', '--json'], root);
	assert.equal(missingFrom.exitCode, 1);
	assert.equal(parseJsonOutput(missingFrom.output).error, 'Missing source run id or path.');

	const missingRun = await runCli(['scene', 'evidence', 'inspect-demo', '--from', 'missing', '--json'], root);
	assert.equal(missingRun.exitCode, 1);
	assert.ok(parseJsonOutput(missingRun.output).diagnostics.some((entry) => entry.code === 'scene.run_not_found'));

	const training = await runCli(['scene', 'training', 'inspect-demo', '--from', runRoot, '--json'], root);
	assert.equal(training.exitCode, 0);
	const result = await runCli(['scene', 'evidence', 'inspect-demo', '--from', runRoot, '--target', 'ci', '--bundle', 'sanitized', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene evidence');
	assert.equal(payload.phase, 9);
	assert.equal(payload.sceneId, 'inspect-demo');
	assert.equal(payload.manifest.target, 'ci');
	assert.equal(payload.manifest.bundlePolicy, 'sanitized');
	assert.ok(payload.paths.manifestPath.endsWith('/evidence/manifest.json'));
	assert.ok(payload.paths.bundleManifestPath.endsWith('/evidence/bundle/bundle-manifest.json'));
	assert.ok(payload.manifest.artifacts.some((entry) => entry.kind === 'training-output'));
	const updatedRun = JSON.parse(readFileSync(resolve(runRoot, 'run.json'), 'utf8'));
	assert.equal(updatedRun.evidencePaths.evidenceRoot, payload.evidenceRoot);
});

test('scene publish validates arguments and writes a local redacted bundle', async () => {
	const missingScene = await runCli(['scene', 'publish', '--json']);
	assert.equal(missingScene.exitCode, 1);
	assert.equal(parseJsonOutput(missingScene.output).error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missingFrom = await runCli(['scene', 'publish', 'inspect-demo', '--json'], root);
	assert.equal(missingFrom.exitCode, 1);
	assert.equal(parseJsonOutput(missingFrom.output).error, 'Missing source run id or path.');

	const missingRun = await runCli(['scene', 'publish', 'inspect-demo', '--from', 'missing', '--json'], root);
	assert.equal(missingRun.exitCode, 1);
	assert.ok(parseJsonOutput(missingRun.output).diagnostics.some((entry) => entry.code === 'scene.run_not_found'));

	const badTarget = await runCli(['scene', 'publish', 'inspect-demo', '--from', runRoot, '--target', 'ci', '--json'], root);
	assert.equal(badTarget.exitCode, 1);
	assert.ok(parseJsonOutput(badTarget.output).diagnostics.some((entry) => entry.code === 'scene.publish_target_unsupported'));

	const result = await runCli(['scene', 'publish', 'inspect-demo', '--from', runRoot, '--target', 'local', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene publish');
	assert.equal(payload.phase, 10);
	assert.equal(payload.status, 'published');
	assert.equal(payload.sceneId, 'inspect-demo');
	assert.ok(payload.paths.manifestPath.endsWith('/publish/local/manifest.json'));
	assert.ok(payload.paths.bundleRoot.endsWith('/publish/local/bundle'));
	assert.ok(payload.manifest.artifacts.some((entry) => entry.kind === 'run-report' && entry.decision === 'include'));
	const updatedRun = JSON.parse(readFileSync(resolve(runRoot, 'run.json'), 'utf8'));
	assert.equal(updatedRun.publishPaths.publishRoot, payload.publishRoot);

	const release = await runCli(['scene', 'publish', 'inspect-demo', '--from', runRoot, '--target', 'release', '--json'], root);
	assert.equal(release.exitCode, 1);
	assert.ok(parseJsonOutput(release.output).diagnostics.some((entry) => entry.code === 'scene.publish_release_blocked'));
});

test('scene publish-plan validates arguments and writes a plan', async () => {
	const missingScene = await runCli(['scene', 'publish-plan', '--json']);
	assert.equal(missingScene.exitCode, 1);
	assert.equal(parseJsonOutput(missingScene.output).error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missingFrom = await runCli(['scene', 'publish-plan', 'inspect-demo', '--json'], root);
	assert.equal(missingFrom.exitCode, 1);
	assert.equal(parseJsonOutput(missingFrom.output).error, 'Missing source run id or path.');

	const missingRun = await runCli(['scene', 'publish-plan', 'inspect-demo', '--from', 'missing', '--json'], root);
	assert.equal(missingRun.exitCode, 1);
	assert.ok(parseJsonOutput(missingRun.output).diagnostics.some((entry) => entry.code === 'scene.run_not_found'));

	const badTarget = await runCli(['scene', 'publish-plan', 'inspect-demo', '--from', runRoot, '--target', 'docs,bad', '--json'], root);
	assert.equal(badTarget.exitCode, 1);
	assert.ok(parseJsonOutput(badTarget.output).diagnostics.some((entry) => entry.code === 'scene.publish_plan_target_unsupported'));

	const result = await runCli(['scene', 'publish-plan', 'inspect-demo', '--from', runRoot, '--target', 'docs,training', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene publish-plan');
	assert.equal(payload.phase, 11);
	assert.equal(payload.sceneId, 'inspect-demo');
	assert.deepEqual(payload.manifest.targets, ['docs', 'training']);
	assert.ok(payload.manifest.reconciliationIntents.every((entry) => entry.action === 'plan-only'));
	assert.ok(payload.paths.manifestPath.endsWith('/publish-plan/manifest.json'));
	const updatedRun = JSON.parse(readFileSync(resolve(runRoot, 'run.json'), 'utf8'));
	assert.equal(updatedRun.publishPlanPaths.publishPlanRoot, payload.publishPlanRoot);

	const releasePlan = await runCli(['scene', 'publish-plan', 'inspect-demo', '--from', runRoot, '--target', 'release-evidence', '--json'], root);
	assert.equal(releasePlan.exitCode, 1);
	assert.ok(parseJsonOutput(releasePlan.output).diagnostics.some((entry) => entry.code === 'scene.publish_plan_release_blocked'));
});

test('scene export validates arguments and writes a local publication export', async () => {
	const missingScene = await runCli(['scene', 'export', '--json']);
	assert.equal(missingScene.exitCode, 1);
	assert.equal(parseJsonOutput(missingScene.output).error, 'Missing scene manifest path.');

	const root = makeWorkspace();
	const runRoot = writeInspectableRun(root);
	const missingFrom = await runCli(['scene', 'export', 'inspect-demo', '--json'], root);
	assert.equal(missingFrom.exitCode, 1);
	assert.equal(parseJsonOutput(missingFrom.output).error, 'Missing source run id or path.');

	const result = await runCli(['scene', 'export', 'inspect-demo', '--from', runRoot, '--target', 'docs,training', '--json'], root);
	assert.equal(result.exitCode, 0);
	const payload = parseJsonOutput(result.output);
	assert.equal(payload.command, 'scene export');
	assert.equal(payload.phase, 11);
	assert.equal(payload.manifest.mode, 'local-export');
	assert.ok(payload.paths.exportRoot.endsWith('/publish-plan/export'));
	assert.ok(payload.paths.exportManifestPath.endsWith('/publish-plan/export/export-manifest.json'));
});
