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

import { humanSceneStatusLines, setupSummary, writeSceneJsonLine, renderMode, executionMode, sceneDevice, sceneDevices, sceneRoles, splitCommaOption, scenePathRoots, sceneReviewDetail, sceneMaxFindings, trainingFormats, evidenceTarget, evidenceBundlePolicy, publishTarget, externalPublishTargets } from './scene-options.js';

export async function handleScenePublication(action: string, invocation: Parameters<TreeseedCommandHandler>[0], context: Parameters<TreeseedCommandHandler>[1]) {
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

	return null;
}
