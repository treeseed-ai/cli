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


export function humanSceneStatusLines(report: ReturnType<typeof createScenePhase0Report>) {
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

export function setupSummary(report: Awaited<ReturnType<typeof runScene>>) {
	const setup = report.setup;
	if (!setup) return 'not run';
	const parts = [];
	if (setup.environment?.dev.requested) parts.push(setup.environment.dev.reused ? 'dev reused' : setup.environment.dev.started ? 'dev started' : 'dev requested');
	if (setup.seed?.requested) parts.push(setup.seed.mode === 'apply' ? 'seed applied' : 'seed planned');
	if (setup.auth?.required) parts.push(setup.auth.hasSession ? 'auth resolved' : 'auth missing');
	return parts.length > 0 ? parts.join(', ') : 'checked';
}

export function writeSceneJsonLine(context: Parameters<CommandHandler>[1], payload: Record<string, unknown>) {
	context.write(JSON.stringify(payload), 'stdout');
}

export function renderMode(value: unknown): SceneRenderMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (['demo', 'training', 'failure-review', 'chapter', 'diagram-only'].includes(value)) return value as SceneRenderMode;
	return undefined;
}

export function executionMode(value: unknown): SceneExecutionMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (['acceptance', 'demo', 'training', 'record-only'].includes(value)) return value as SceneExecutionMode;
	return undefined;
}

export function sceneDevice(value: unknown): SceneDeviceProfileId | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function sceneDevices(value: unknown): SceneDeviceProfileId[] | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function sceneRoles(value: unknown): SceneVisualAuditRole[] | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function splitCommaOption(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const values = value.flatMap((entry) => String(entry).split(',').map((part) => part.trim()).filter(Boolean));
		return values.length > 0 ? values : undefined;
	}
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const values = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return values.length > 0 ? values : undefined;
}

export function scenePathRoots(value: unknown): string[] | undefined {
	return splitCommaOption(value);
}

export function sceneReviewDetail(value: unknown): SceneVisualAuditReviewDetail | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	if (['summary', 'standard', 'full'].includes(value)) return value as SceneVisualAuditReviewDetail;
	return undefined;
}

export function sceneMaxFindings(value: unknown): number | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function trainingFormats(value: unknown): SceneTrainingOutputFormat[] | undefined {
	if (typeof value !== 'string') return undefined;
	const formats = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['json', 'markdown', 'vtt', 'srt']);
	return formats.filter((format): format is SceneTrainingOutputFormat => allowed.has(format));
}

export function evidenceTarget(value: unknown): SceneEvidenceTarget | undefined {
	if (typeof value !== 'string') return undefined;
	if (['local', 'ci', 'release'].includes(value)) return value as SceneEvidenceTarget;
	return undefined;
}

export function evidenceBundlePolicy(value: unknown): SceneEvidenceBundlePolicy | undefined {
	if (typeof value !== 'string') return undefined;
	if (['metadata-only', 'sanitized'].includes(value)) return value as SceneEvidenceBundlePolicy;
	return undefined;
}

export function publishTarget(value: unknown): ScenePublishTarget | undefined {
	if (typeof value !== 'string') return undefined;
	if (['local', 'release'].includes(value)) return value as ScenePublishTarget;
	return undefined;
}

export function externalPublishTargets(value: unknown): SceneExternalPublishTarget[] | undefined | null {
	if (typeof value !== 'string') return undefined;
	const targets = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['docs', 'training', 'release-evidence', 'artifact-store']);
	if (targets.some((target) => !allowed.has(target))) return null;
	return targets as SceneExternalPublishTarget[];
}

