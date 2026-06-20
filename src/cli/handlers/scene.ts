import {
	createTreeseedScenePhase0Report,
	formatTreeseedSceneDiagnostics,
	exportTreeseedScenePublication,
	generateTreeseedSceneEvidence,
	generateTreeseedSceneTrainingOutputs,
	inspectTreeseedSceneRun,
	planTreeseedScene,
	planTreeseedScenePublication,
	publishTreeseedSceneEvidence,
	renderTreeseedScene,
	resumeTreeseedScene,
	runTreeseedSceneDeviceMatrix,
	runTreeseedSceneVisualAudit,
	runTreeseedScene,
	validateTreeseedScene,
	type TreeseedSceneEvidenceBundlePolicy,
	type TreeseedSceneEvidenceTarget,
	type TreeseedSceneExecutionMode,
	type TreeseedSceneDeviceProfileId,
	type TreeseedSceneEnvironment,
	type TreeseedSceneExternalPublishTarget,
	type TreeseedSceneRenderFormat,
	type TreeseedSceneRenderMode,
	type TreeseedScenePublishTarget,
	type TreeseedSceneTrainingOutputFormat,
	type TreeseedSceneVisualAuditReviewDetail,
	type TreeseedSceneVisualAuditRole,
} from '@treeseed/sdk/scenes';
import { runTreeseedManagedDev } from '@treeseed/sdk';
import type { TreeseedCommandHandler } from '../types.ts';

function humanSceneStatusLines(report: ReturnType<typeof createTreeseedScenePhase0Report>) {
	return [
		'Treeseed scene platform: Phase 0 foundation ready',
		`Purpose: ${report.name}`,
		'Command surface:',
		...report.commandSurface.map((command) => `  ${command}`),
		`Next phase: ${report.nextPhase.summary}`,
		`Deferred dependencies: ${report.deferredDependencies.join(', ') || '(none)'}`,
		`Active optional dependencies: ${report.activeOptionalDependencies?.join(', ') || '(none)'}`,
	];
}

function setupSummary(report: Awaited<ReturnType<typeof runTreeseedScene>>) {
	const setup = report.setup;
	if (!setup) return 'not run';
	const parts = [];
	if (setup.environment?.dev.requested) parts.push(setup.environment.dev.reused ? 'dev reused' : setup.environment.dev.started ? 'dev started' : 'dev requested');
	if (setup.seed?.requested) parts.push(setup.seed.mode === 'apply' ? 'seed applied' : 'seed planned');
	if (setup.auth?.required) parts.push(setup.auth.hasSession ? 'auth resolved' : 'auth missing');
	return parts.length > 0 ? parts.join(', ') : 'checked';
}

function writeSceneJsonLine(context: Parameters<TreeseedCommandHandler>[1], payload: Record<string, unknown>) {
	context.write(JSON.stringify(payload), 'stdout');
}

function renderMode(value: unknown): TreeseedSceneRenderMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (['demo', 'training', 'failure-review', 'chapter', 'diagram-only'].includes(value)) return value as TreeseedSceneRenderMode;
	return undefined;
}

function executionMode(value: unknown): TreeseedSceneExecutionMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (['acceptance', 'demo', 'training', 'record-only'].includes(value)) return value as TreeseedSceneExecutionMode;
	return undefined;
}

function sceneDevice(value: unknown): TreeseedSceneDeviceProfileId | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sceneDevices(value: unknown): TreeseedSceneDeviceProfileId[] | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function sceneRoles(value: unknown): TreeseedSceneVisualAuditRole[] | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function splitCommaOption(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const values = value.flatMap((entry) => String(entry).split(',').map((part) => part.trim()).filter(Boolean));
		return values.length > 0 ? values : undefined;
	}
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const values = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function scenePathRoots(value: unknown): string[] | undefined {
	return splitCommaOption(value);
}

function sceneReviewDetail(value: unknown): TreeseedSceneVisualAuditReviewDetail | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	if (['summary', 'standard', 'full'].includes(value)) return value as TreeseedSceneVisualAuditReviewDetail;
	return undefined;
}

function sceneMaxFindings(value: unknown): number | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function trainingFormats(value: unknown): TreeseedSceneTrainingOutputFormat[] | undefined {
	if (typeof value !== 'string') return undefined;
	const formats = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['json', 'markdown', 'vtt', 'srt']);
	return formats.filter((format): format is TreeseedSceneTrainingOutputFormat => allowed.has(format));
}

function evidenceTarget(value: unknown): TreeseedSceneEvidenceTarget | undefined {
	if (typeof value !== 'string') return undefined;
	if (['local', 'ci', 'release'].includes(value)) return value as TreeseedSceneEvidenceTarget;
	return undefined;
}

function evidenceBundlePolicy(value: unknown): TreeseedSceneEvidenceBundlePolicy | undefined {
	if (typeof value !== 'string') return undefined;
	if (['metadata-only', 'sanitized'].includes(value)) return value as TreeseedSceneEvidenceBundlePolicy;
	return undefined;
}

function publishTarget(value: unknown): TreeseedScenePublishTarget | undefined {
	if (typeof value !== 'string') return undefined;
	if (['local', 'release'].includes(value)) return value as TreeseedScenePublishTarget;
	return undefined;
}

function externalPublishTargets(value: unknown): TreeseedSceneExternalPublishTarget[] | undefined | null {
	if (typeof value !== 'string') return undefined;
	const targets = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['docs', 'training', 'release-evidence', 'artifact-store']);
	if (targets.some((target) => !allowed.has(target))) return null;
	return targets as TreeseedSceneExternalPublishTarget[];
}

export const handleScene: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	if (action === 'status') {
		const report = createTreeseedScenePhase0Report();
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
		const report = validateTreeseedScene({ projectRoot: context.cwd, scene });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene validation passed.',
					`Scene: ${report.scene?.id ?? '(unknown)'}`,
					`Path: ${report.scenePath}`,
					`Workflow steps: ${report.scene?.workflow.length ?? 0}`,
				]
				: ['Treeseed scene validation failed.', ...formatTreeseedSceneDiagnostics(report.diagnostics)],
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
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as TreeseedSceneEnvironment : undefined;
		const report = planTreeseedScene({ projectRoot: context.cwd, scene, environment });
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
				: ['Treeseed scene plan failed.', ...formatTreeseedSceneDiagnostics(report.diagnostics)],
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
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as TreeseedSceneEnvironment : undefined;
		const mode = executionMode(invocation.args.mode);
		const deviceArg = sceneDevice(invocation.args.device);
		const requestedDevices = deviceArg === 'all' ? undefined : sceneDevices(invocation.args.device);
		if (deviceArg === 'all' || (requestedDevices && requestedDevices.length > 1)) {
			const matrixReport = await runTreeseedSceneDeviceMatrix({
				projectRoot: context.cwd,
				scene,
				environment,
				record: invocation.args.record === true,
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
						: ['Treeseed scene device matrix failed.', ...formatTreeseedSceneDiagnostics(matrixReport.diagnostics)],
				stderr: [],
				report: { command: 'scene run', matrix: true, ...matrixReport },
			};
		}
		const jsonl = context.outputFormat === 'json';
		const report = await runTreeseedScene({
			projectRoot: context.cwd,
			scene,
			environment,
			device: deviceArg,
			record: invocation.args.record === true,
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
					...formatTreeseedSceneDiagnostics(report.diagnostics),
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
		const report = inspectTreeseedSceneRun({ projectRoot: context.cwd, run, stepId: typeof invocation.args.step === 'string' ? invocation.args.step : undefined });
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
				: ['Treeseed scene inspect failed.', ...formatTreeseedSceneDiagnostics(report.diagnostics)],
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
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as TreeseedSceneEnvironment : undefined;
		if (invocation.args.freshDev === true && environment && environment !== 'local') {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['--fresh-dev is only supported for local visual audits.'],
				report: { command: 'scene visual-audit', ok: false, diagnostics: [{ severity: 'error', code: 'scene.visual_audit_fresh_dev_local_only', message: '--fresh-dev is only supported for local visual audits.', path: 'freshDev' }] },
			};
		}
		if (invocation.args.freshDev === true) {
			await runTreeseedManagedDev({ action: 'start', cwd: context.cwd, webRuntime: 'local', force: true });
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
		const report = await runTreeseedSceneVisualAudit({
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
					...formatTreeseedSceneDiagnostics(report.diagnostics),
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
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment as TreeseedSceneEnvironment : undefined;
		const jsonl = context.outputFormat === 'json';
		const report = await resumeTreeseedScene({
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
				: ['Treeseed scene resume failed.', ...formatTreeseedSceneDiagnostics(report.diagnostics)],
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
		const format = typeof invocation.args.format === 'string' ? invocation.args.format as TreeseedSceneRenderFormat : undefined;
		const report = await renderTreeseedScene({
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
					...formatTreeseedSceneDiagnostics(report.diagnostics),
					`Render root: ${report.renderRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene render', ...report },
		};
	}

	if (action === 'training') {
		const scene = invocation.positionals[1];
		const from = typeof invocation.args.from === 'string' ? invocation.args.from : undefined;
		if (!scene || !from) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene training <scene.yaml> --from <run-id-or-path> [--format json|markdown|vtt|srt] [--json]'],
				report: { command: 'scene training', ok: false, error: !scene ? 'Missing scene manifest path.' : 'Missing source run id or path.' },
			};
		}
		const report = generateTreeseedSceneTrainingOutputs({
			projectRoot: context.cwd,
			scene,
			from,
			formats: trainingFormats(invocation.args.format),
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene training outputs generated.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					`Captions: ${report.paths?.captionsVttPath ?? report.paths?.captionsSrtPath ?? '(none)'}`,
					`Transcript: ${report.paths?.transcriptMarkdownPath ?? report.paths?.transcriptJsonPath ?? '(none)'}`,
					`Narration: ${report.paths?.narrationMarkdownPath ?? report.paths?.narrationJsonPath ?? '(none)'}`,
					`Glossary: ${report.paths?.glossaryMarkdownPath ?? report.paths?.glossaryJsonPath ?? '(none)'}`,
					`Chapter clips: ${report.paths?.chapterClipsPath ?? '(none)'}`,
				]
				: [
					'Treeseed scene training output failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					...formatTreeseedSceneDiagnostics(report.diagnostics),
					`Training root: ${report.trainingRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene training', ...report },
		};
	}

	if (action === 'evidence') {
		const scene = invocation.positionals[1];
		const from = typeof invocation.args.from === 'string' ? invocation.args.from : undefined;
		if (!scene || !from) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene evidence <scene.yaml> --from <run-id-or-path> [--target local|ci|release] [--bundle metadata-only|sanitized] [--json]'],
				report: { command: 'scene evidence', ok: false, error: !scene ? 'Missing scene manifest path.' : 'Missing source run id or path.' },
			};
		}
		const report = generateTreeseedSceneEvidence({
			projectRoot: context.cwd,
			scene,
			from,
			target: evidenceTarget(invocation.args.target),
			bundlePolicy: evidenceBundlePolicy(invocation.args.bundle),
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene evidence generated.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					`Target: ${report.manifest?.target ?? '(unknown)'}`,
					`Bundle: ${report.manifest?.bundlePolicy ?? '(unknown)'}`,
					`Manifest: ${report.paths?.manifestPath ?? '(none)'}`,
					`Report: ${report.paths?.reportPath ?? '(none)'}`,
					`Bundle root: ${report.paths?.bundleRoot ?? '(none)'}`,
				]
				: [
					'Treeseed scene evidence failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					...formatTreeseedSceneDiagnostics(report.diagnostics),
					`Evidence root: ${report.evidenceRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene evidence', ...report },
		};
	}

	if (action === 'publish') {
		const scene = invocation.positionals[1];
		const from = typeof invocation.args.from === 'string' ? invocation.args.from : undefined;
		if (!scene || !from) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene publish <scene.yaml> --from <run-id-or-path> [--target local|release] [--redaction-policy <path>] [--json]'],
				report: { command: 'scene publish', ok: false, error: !scene ? 'Missing scene manifest path.' : 'Missing source run id or path.' },
			};
		}
		const target = publishTarget(invocation.args.target);
		if (typeof invocation.args.target === 'string' && !target) {
			const diagnostic = { severity: 'error' as const, code: 'scene.publish_target_unsupported', message: `Unsupported scene publish target "${invocation.args.target}".`, path: 'target' };
			return {
				exitCode: 1,
				stdout: ['Treeseed scene publish failed.', ...formatTreeseedSceneDiagnostics([diagnostic])],
				stderr: [],
				report: { command: 'scene publish', ok: false, phase: 10, diagnostics: [diagnostic], warnings: [], blockers: [diagnostic] },
			};
		}
		const report = await publishTreeseedSceneEvidence({
			projectRoot: context.cwd,
			scene,
			from,
			target,
			redactionPolicyPath: typeof invocation.args.redactionPolicy === 'string' ? invocation.args.redactionPolicy : undefined,
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene publish completed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					`Target: ${report.manifest?.target ?? '(unknown)'}`,
					`Manifest: ${report.paths?.manifestPath ?? '(none)'}`,
					`Report: ${report.paths?.reportPath ?? '(none)'}`,
					`Bundle root: ${report.paths?.bundleRoot ?? '(none)'}`,
				]
				: [
					'Treeseed scene publish failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					...formatTreeseedSceneDiagnostics(report.diagnostics),
					`Publish root: ${report.publishRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene publish', ...report },
		};
	}

	if (action === 'publish-plan') {
		const scene = invocation.positionals[1];
		const from = typeof invocation.args.from === 'string' ? invocation.args.from : undefined;
		if (!scene || !from) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene publish-plan <scene.yaml> --from <run-id-or-path> [--target docs,training,release-evidence,artifact-store] [--json]'],
				report: { command: 'scene publish-plan', ok: false, error: !scene ? 'Missing scene manifest path.' : 'Missing source run id or path.' },
			};
		}
		const targets = externalPublishTargets(invocation.args.target);
		if (targets === null) {
			const diagnostic = { severity: 'error' as const, code: 'scene.publish_plan_target_unsupported', message: `Unsupported scene publication target "${invocation.args.target}".`, path: 'target' };
			return {
				exitCode: 1,
				stdout: ['Treeseed scene publish plan failed.', ...formatTreeseedSceneDiagnostics([diagnostic])],
				stderr: [],
				report: { command: 'scene publish-plan', ok: false, phase: 11, diagnostics: [diagnostic], warnings: [], blockers: [diagnostic] },
			};
		}
		const report = await planTreeseedScenePublication({
			projectRoot: context.cwd,
			scene,
			from,
			targets,
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene publish plan ready.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					`Targets: ${report.manifest?.targets.join(', ') ?? '(none)'}`,
					`Destinations: ${report.manifest?.destinations.length ?? 0}`,
					`Artifacts: ${report.manifest?.artifacts.length ?? 0}`,
					`Manifest: ${report.paths?.manifestPath ?? '(none)'}`,
					`Report: ${report.paths?.reportPath ?? '(none)'}`,
				]
				: [
					'Treeseed scene publish plan failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					...formatTreeseedSceneDiagnostics(report.diagnostics),
					`Publish plan root: ${report.publishPlanRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene publish-plan', ...report },
		};
	}

	if (action === 'export') {
		const scene = invocation.positionals[1];
		const from = typeof invocation.args.from === 'string' ? invocation.args.from : undefined;
		if (!scene || !from) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: ['Usage: treeseed scene export <scene.yaml> --from <run-id-or-path> [--target docs,training,release-evidence,artifact-store] [--json]'],
				report: { command: 'scene export', ok: false, error: !scene ? 'Missing scene manifest path.' : 'Missing source run id or path.' },
			};
		}
		const targets = externalPublishTargets(invocation.args.target);
		if (targets === null) {
			const diagnostic = { severity: 'error' as const, code: 'scene.publish_plan_target_unsupported', message: `Unsupported scene publication target "${invocation.args.target}".`, path: 'target' };
			return {
				exitCode: 1,
				stdout: ['Treeseed scene publication export failed.', ...formatTreeseedSceneDiagnostics([diagnostic])],
				stderr: [],
				report: { command: 'scene export', ok: false, phase: 11, diagnostics: [diagnostic], warnings: [], blockers: [diagnostic] },
			};
		}
		const report = await exportTreeseedScenePublication({
			projectRoot: context.cwd,
			scene,
			from,
			targets,
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed scene publication export completed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					`Targets: ${report.manifest?.targets.join(', ') ?? '(none)'}`,
					`Export root: ${report.paths?.exportRoot ?? '(none)'}`,
					`Manifest: ${report.paths?.exportManifestPath ?? '(none)'}`,
				]
				: [
					'Treeseed scene publication export failed.',
					`Scene: ${report.sceneId ?? '(unknown)'}`,
					`Source run: ${report.sourceRunId ?? '(none)'}`,
					...formatTreeseedSceneDiagnostics(report.diagnostics),
					`Publish plan root: ${report.publishPlanRoot ?? '(none)'}`,
				],
			stderr: [],
			report: { command: 'scene export', ...report },
		};
	}

	if (action !== 'status') {
		const message = `Unsupported scene action "${action}". Phase 11 supports status, validate, plan, run, inspect, resume, render, training, evidence, publish, publish-plan, export, and visual-audit.`;
		return {
			exitCode: 1,
			stdout: [],
			stderr: [message],
			report: {
				command: 'scene',
				ok: false,
				phase: 11,
				error: message,
				supportedActions: ['status', 'validate', 'plan', 'run', 'inspect', 'resume', 'render', 'training', 'evidence', 'publish', 'publish-plan', 'export', 'visual-audit'],
			},
		};
	}
};
