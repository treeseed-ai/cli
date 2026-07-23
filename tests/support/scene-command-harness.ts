import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const { runTreeseedCli } = await import('../../dist/cli/main.js');

export async function runCli(args, cwd = process.cwd()) {
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

export function makeWorkspace() {
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

export function parseJsonOutput(output) {
	const start = output.indexOf('{');
	assert.notEqual(start, -1, `Expected JSON output, got:\n${output}`);
	return JSON.parse(output.slice(start));
}

export function parseJsonLines(output) {
	return output
		.split(/\n+/u)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line));
}

export function writeInspectableRun(root) {
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
