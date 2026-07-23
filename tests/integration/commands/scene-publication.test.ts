import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	makeWorkspace,
	parseJsonLines,
	parseJsonOutput,
	runCli,
	writeInspectableRun,
} from '../../support/scene-command-harness.ts';

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

