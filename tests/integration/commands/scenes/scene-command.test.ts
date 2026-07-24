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
} from '../../../support/scene-command-harness.ts';

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

