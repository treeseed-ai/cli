import {
	createScenePhase0Report,
	formatSceneDiagnostics,
	exportScenePublication,
	generateSceneEvidence,
	generateSceneTrainingOutputs,
	inspectSceneRun,
	planScene,
	planScenePublication,
	publishSceneEvidence,
	renderScene,
	resumeScene,
	runSceneDeviceMatrix,
	runSceneVisualAudit,
	runScene,
	validateScene,
	type SceneEvidenceBundlePolicy,
	type SceneEvidenceTarget,
	type SceneExecutionMode,
	type SceneDeviceProfileId,
	type SceneEnvironment,
	type SceneExternalPublishTarget,
	type SceneRenderFormat,
	type SceneRenderMode,
	type ScenePublishTarget,
	type SceneTrainingOutputFormat,
	type SceneVisualAuditReviewDetail,
	type SceneVisualAuditRole,
} from '@treeseed/sdk/scenes';
import { runManagedDev } from '@treeseed/sdk';
import type { CommandHandler } from '../../types.ts';

import { humanSceneStatusLines, setupSummary, writeSceneJsonLine, renderMode, executionMode, sceneDevice, sceneDevices, sceneRoles, splitCommaOption, scenePathRoots, sceneReviewDetail, sceneMaxFindings, trainingFormats, evidenceTarget, evidenceBundlePolicy, publishTarget, externalPublishTargets } from './scene-options.js';

export async function handleSceneExecution(action: string, invocation: Parameters<CommandHandler>[0], context: Parameters<CommandHandler>[1]) {
	if (action === 'status') {
		const report = createScenePhase0Report();
		return {
			exitCode: 0,
			stdout: humanSceneStatusLines(report),
			stderr: [],
			report: {
				command: 'scene',
				...report,
			},
		};
	}

	if (action === 'validate') {
		const scene = invocation.positionals[1];
		if (!scene) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene validate <scene.yaml> [--json]'],
				report: { command: 'scene validate', ok: false, error: 'Missing scene manifest path.' },
			};
		}
		const report = validateScene({ projectRoot: context.cwd, scene });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene validation passed.',
					`Scene: ${report.scene?.id ?? '(unknown)'}`,
					`Path: ${report.scenePath}`,
					`Workflow steps: ${report.scene?.workflow.length ?? 0}`,
				]
				: ['Treeseed scene validation failed.', ...formatSceneDiagnostics(report.diagnostics)],
			stderr: [],
			report: { command: 'scene validate', ...report },
		};
	}

	if (action === 'plan') {
		const scene = invocation.positionals[1];
		if (!scene) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene plan <scene.yaml> [--environment local|staging|prod] [--json]'],
				report: { command: 'scene plan', ok: false, error: 'Missing scene manifest path.' },
			};
		}
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as SceneEnvironment : undefined;
		const report = planScene({ projectRoot: context.cwd, scene, environment });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene plan ready.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Environment: ${report.environment}`,
					`Browser: ${report.browser ?? '(unknown)'}`,
					`Workflow steps: ${report.workflowSteps.length}`,
					`Artifacts: ${report.artifactPaths?.runRoot ?? '(none)'}`,
					`Actions: ${report.enabledActions.join(', ') || '(none)'}`,
					`Assertions: ${report.enabledAssertions.join(', ') || '(none)'}`,
					`Plugins: ${report.enabledPlugins.join(', ') || '(none)'}`,
				]
				: ['Treeseed scene plan failed.', ...formatSceneDiagnostics(report.diagnostics)],
			stderr: [],
			report: { command: 'scene plan', ...report },
		};
	}

	if (action === 'run') {
		const scene = invocation.positionals[1];
		if (!scene) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene run <scene.yaml> [--environment local|staging|prod] [--record] [--json]'],
				report: { command: 'scene run', ok: false, error: 'Missing scene manifest path.' },
			};
		}
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as SceneEnvironment : undefined;
		const mode = executionMode(invocation.args.mode);
		const deviceArg = sceneDevice(invocation.args.device);
		const requestedDevices = deviceArg === 'all' ? undefined : sceneDevices(invocation.args.device);
		if (deviceArg === 'all' || (requestedDevices && requestedDevices.length > 1)) {
			const matrixReport = await runSceneDeviceMatrix({
				projectRoot: context.cwd,
				scene,
				environment,
				record: invocation.args.record === true,
				artifactMode: invocation.args.noSceneVideo === true ? 'screenshots' : typeof invocation.args.sceneArtifacts === 'string' ? invocation.args.sceneArtifacts as 'full' | 'screenshots' : undefined,
				mode,
				devices: requestedDevices,
			});
			return {
				exitCode: matrixReport.ok ? 0 : 1,
				stdout: context.outputFormat === 'json'
					? []
					: matrixReport.ok
						? [
							'Treeseed scene device matrix completed.',
							`Scene: ${matrixReport.sceneId ?? '(unknown)'}`,
							`Matrix: ${matrixReport.matrixId ?? '(none)'}`,
							`Devices: ${matrixReport.devices.join(', ') || '(none)'}`,
							`Runs: ${matrixReport.runReports.length}`,
							`Matrix report: ${matrixReport.matrixPath ?? '(none)'}`,
						]
						: ['Treeseed scene device matrix failed.', ...formatSceneDiagnostics(matrixReport.diagnostics)],
				stderr: [],
				report: { command: 'scene run', matrix: true, ...matrixReport },
			};
		}
		const jsonl = context.outputFormat === 'json';
		const report = await runScene({
			projectRoot: context.cwd,
			scene,
			environment,
			device: deviceArg,
			record: invocation.args.record === true,
			artifactMode: invocation.args.noSceneVideo === true ? 'screenshots' : typeof invocation.args.sceneArtifacts === 'string' ? invocation.args.sceneArtifacts as 'full' | 'screenshots' : undefined,
			mode,
			interactive: context.interactiveUi,
			pauseController: context.confirm
				? async (pause) => {
					const ok = await context.confirm!(pause.prompt ?? pause.title, false);
					return ok
						? { ok: true, diagnostics: [] }
						: { ok: false, diagnostics: [{ severity: 'error', code: 'scene.manual_pause_cancelled', message: 'Manual pause was not confirmed.', path: `workflow.${pause.stepId}.action.pause` }] };
				}
				: undefined,
			onProgress: jsonl
				? (event) => writeSceneJsonLine(context, { command: 'scene run', kind: 'event', event })
				: undefined,
		});
		const passed = report.steps.filter((step) => step.status === 'passed').length;
		const failed = report.steps.filter((step) => step.status === 'failed').length;
		if (jsonl) {
			writeSceneJsonLine(context, { command: 'scene run', kind: 'final', ok: report.ok, report });
			return { exitCode: report.ok ? 0 : 1, stdout: [], stderr: [], report: { command: 'scene run', ...report }, suppressJsonResult: true };
		}
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene run completed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Run: ${report.runId ?? '(none)'}`,
					`Environment: ${report.environment}`,
					`Base URL: ${report.baseUrl ?? '(unresolved)'}`,
					`Setup: ${setupSummary(report)}`,
					`Workflow: ${report.workflowStatus}`,
					`Steps: ${passed} passed, ${failed} failed`,
					`Artifacts: ${report.artifacts?.runRoot ?? '(none)'}`,
					`Trace: ${report.playwrightTracePath ?? '(none)'}`,
					`Report: ${report.artifacts?.markdownReportPath ?? '(none)'}`,
				]
				: [
					report.workflowStatus === 'blocked' ? 'Treeseed scene run blocked.' : 'Treeseed scene run failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Failed step: ${report.failedStep ?? '(none)'}`,
					`Setup: ${setupSummary(report)}`,
					...formatSceneDiagnostics(report.diagnostics),
					`Artifacts: ${report.artifacts?.runRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene run', ...report },
		};
	}

	if (action === 'inspect') {
		const run = invocation.positionals[1];
		if (!run) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene inspect <run-id-or-path> [--step <step-id>] [--json]'],
				report: { command: 'scene inspect', ok: false, error: 'Missing run id or path.' },
			};
		}
		const report = inspectSceneRun({ projectRoot: context.cwd, run, stepId: typeof invocation.args.step === 'string' ? invocation.args.step : undefined });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene run inspected.',
					`Scene: ${report.run?.sceneId ?? '(unknown)'}`,
					`Run: ${report.run?.runId ?? '(none)'}`,
					`Workflow: ${report.run?.workflowStatus ?? '(unknown)'}`,
					`Chapters: ${report.chapters.length}`,
					`Segments: ${report.segments.length}`,
					`Checkpoints: ${report.checkpoints.length}`,
					`Selected step: ${report.selectedStep ? `${report.selectedStep.id} ${report.selectedStep.status}` : '(none)'}`,
					`Artifacts: ${report.runRoot ?? '(none)'}`,
				]
				: ['Treeseed scene inspect failed.', ...formatSceneDiagnostics(report.diagnostics)],
			stderr: [],
			report: { command: 'scene inspect', ...report },
		};
	}

	if (action === 'visual-audit') {
		const scene = invocation.positionals[1];
		if (!scene) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene visual-audit <scene.yaml> [--environment local|staging|prod] [--roles anonymous,owner,admin,member] [--device desktop|tablet|mobile|all] [--path-root /app,/auth,/market] [--path /app/**] [--exclude-path **/delete] [--full-page] [--json]'],
				report: { command: 'scene visual-audit', ok: false, error: 'Missing scene manifest path.' },
			};
		}
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as SceneEnvironment : undefined;
		if (invocation.args.freshDev === true && environment && environment !== 'local') {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['--fresh-dev is only supported for local visual audits.'],
				report: { command: 'scene visual-audit', ok: false, diagnostics: [{ severity: 'error', code: 'scene.visual_audit_fresh_dev_local_only', message: '--fresh-dev is only supported for local visual audits.', path: 'freshDev' }] },
			};
		}
		if (invocation.args.freshDev === true) {
			await runManagedDev({ action: 'start', cwd: context.cwd, webRuntime: 'local', force: true });
		}
		const deviceArg = sceneDevice(invocation.args.device);
		const devices = deviceArg === 'all' ? undefined : sceneDevices(invocation.args.device);
		if (invocation.args.reviewDetail !== undefined && !sceneReviewDetail(invocation.args.reviewDetail)) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Invalid visual audit review detail. Expected summary, standard, or full.'],
				report: { command: 'scene visual-audit', ok: false, diagnostics: [{ severity: 'error', code: 'scene.visual_audit_invalid_review_detail', message: 'Invalid visual audit review detail. Expected summary, standard, or full.', path: 'reviewDetail' }] },
			};
		}
		if (invocation.args.maxFindings !== undefined && !sceneMaxFindings(invocation.args.maxFindings)) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Invalid visual audit max findings. Expected a positive integer.'],
				report: { command: 'scene visual-audit', ok: false, diagnostics: [{ severity: 'error', code: 'scene.visual_audit_invalid_max_findings', message: 'Invalid visual audit max findings. Expected a positive integer.', path: 'maxFindings' }] },
			};
		}
		const report = await runSceneVisualAudit({
			projectRoot: context.cwd,
			scene,
			environment,
			roles: sceneRoles(invocation.args.roles),
			devices,
			pathRoots: scenePathRoots(invocation.args.pathRoot),
			pathGlobs: splitCommaOption(invocation.args.path),
			excludePathGlobs: splitCommaOption(invocation.args.excludePath),
			includeFullPage: invocation.args.fullPage === true,
			review: invocation.args.noReview === true ? false : invocation.args.review === true ? true : undefined,
			reviewDetail: sceneReviewDetail(invocation.args.reviewDetail),
			maxFindings: sceneMaxFindings(invocation.args.maxFindings),
		});
		const topPriority = report.review
			? [...report.review.rootCauses, ...report.review.incidents]
				.sort((a, b) => b.priorityScore - a.priorityScore)
				.slice(0, 10)
				.map((entry) => ({
					id: entry.id,
					priorityRank: entry.priorityRank,
					priorityScore: entry.priorityScore,
					severity: entry.severity,
					owner: entry.suspectedOwner,
					title: entry.title,
					count: entry.count,
					pathRoots: entry.pathRoots,
					exampleScreenshotPath: entry.exampleScreenshotPath,
				}))
			: [];
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene visual audit completed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Audit: ${report.auditId ?? '(none)'}`,
					`Roles: ${report.roles.join(', ') || '(none)'}`,
					`Devices: ${report.devices.join(', ') || '(none)'}`,
					`Routes: ${report.routeCount}`,
					`Captures: ${report.captureCount}`,
					`Failed: ${report.failedCount}`,
					`Review findings: ${report.reviewFindingCount}`,
					`Root causes: ${report.rootCauseCount}`,
					`Incidents: ${report.incidentCount}`,
					`Raw client errors: ${report.clientErrorCount}`,
					`Top priority: ${topPriority[0] ? `${topPriority[0].owner} ${topPriority[0].title} (${topPriority[0].priorityScore})` : '(none)'}`,
					`Audit root: ${report.auditRoot ?? '(none)'}`,
					`Report: ${report.paths?.reportPath ?? '(none)'}`,
					`Issue index: ${report.paths?.reviewRoot ? `${report.paths.reviewRoot}/issue-index.json` : '(none)'}`,
					`Agent brief: ${report.paths?.reviewAgentBriefPath ?? '(none)'}`,
				]
				: [
					'Treeseed scene visual audit failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					...formatSceneDiagnostics(report.diagnostics),
					`Audit root: ${report.auditRoot ?? '(none)'}`,
			],
			stderr: [],
			report: { command: 'scene visual-audit', ...report, topPriority },
		};
	}

	if (action === 'resume') {
		const run = invocation.positionals[1];
		const fromCheckpoint = typeof invocation.args.fromCheckpoint === 'string' ? invocation.args.fromCheckpoint : undefined;
		if (!run || !fromCheckpoint) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene resume <run-id-or-path> --from-checkpoint <checkpoint-id> [--json]'],
				report: { command: 'scene resume', ok: false, error: !run ? 'Missing run id or path.' : 'Missing checkpoint id.' },
			};
		}
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as SceneEnvironment : undefined;
		const jsonl = context.outputFormat === 'json';
		const report = await resumeScene({
			projectRoot: context.cwd,
			run,
			fromCheckpoint,
			environment,
			record: invocation.args.record === true,
			interactive: context.interactiveUi,
			pauseController: context.confirm
				? async (pause) => {
					const ok = await context.confirm!(pause.prompt ?? pause.title, false);
					return ok
						? { ok: true, diagnostics: [] }
						: { ok: false, diagnostics: [{ severity: 'error', code: 'scene.manual_pause_cancelled', message: 'Manual pause was not confirmed.', path: `workflow.${pause.stepId}.action.pause` }] };
				}
				: undefined,
			onProgress: jsonl
				? (event) => writeSceneJsonLine(context, { command: 'scene resume', kind: 'event', event })
				: undefined,
		});
		if (jsonl) {
			writeSceneJsonLine(context, { command: 'scene resume', kind: 'final', ok: report.ok, report });
			return { exitCode: report.ok ? 0 : 1, stdout: [], stderr: [], report: { command: 'scene resume', ...report }, suppressJsonResult: true };
		}
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene resume completed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Run: ${report.runId ?? '(none)'}`,
					`Workflow: ${report.workflowStatus}`,
					`Artifacts: ${report.artifacts?.runRoot ?? '(none)'}`,
				]
				: ['Treeseed scene resume failed.', ...formatSceneDiagnostics(report.diagnostics)],
			stderr: [],
			report: { command: 'scene resume', ...report },
		};
	}

	if (action === 'render') {
		const scene = invocation.positionals[1];
		const from = typeof invocation.args.from === 'string' ? invocation.args.from : undefined;
		if (!scene || !from) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene render <scene.yaml> --from <run-id-or-path> [--renderer remotion] [--format mp4] [--mode demo|training|failure-review|chapter|diagram-only] [--json]'],
				report: { command: 'scene render', ok: false, error: !scene ? 'Missing scene manifest path.' : 'Missing source run id or path.' },
			};
		}
		const renderer = typeof invocation.args.renderer === 'string' ? invocation.args.renderer : 'remotion';
		const format = typeof invocation.args.format === 'string' ? invocation.args.format as SceneRenderFormat : undefined;
		const report = await renderScene({
			projectRoot: context.cwd,
			scene,
			from,
			renderer,
			format,
			device: sceneDevice(invocation.args.device),
			mode: renderMode(invocation.args.mode),
			composition: typeof invocation.args.composition === 'string' ? invocation.args.composition : undefined,
			chapterId: typeof invocation.args.chapter === 'string' ? invocation.args.chapter : undefined,
			output: typeof invocation.args.output === 'string' ? invocation.args.output : undefined,
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene render completed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					`Renderer: ${report.renderer}`,
					`Composition: ${report.composition ?? '(none)'}`,
					`Format: ${report.format}`,
					`Output: ${report.outputPath ?? '(none)'}`,
					...(report.trainingOutputPaths ? [
						`Training outputs: ${report.trainingOutputPaths.trainingRoot}`,
						`Captions: ${report.trainingOutputPaths.captionsVttPath ?? report.trainingOutputPaths.captionsSrtPath ?? '(none)'}`,
					] : []),
				]
				: [
					'Treeseed scene render failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					...formatSceneDiagnostics(report.diagnostics),
					`Render root: ${report.renderRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene render', ...report },
		};
	}

	return null;
}
