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


export function humanSceneStatusLines(report: ReturnType<typeof createTreeseedScenePhase0Report>) {
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

export function setupSummary(report: Awaited<ReturnType<typeof runTreeseedScene>>) {
	const setup = report.setup;
	if (!setup) return 'not run';
	const parts = [];
	if (setup.environment?.dev.requested) parts.push(setup.environment.dev.reused ? 'dev reused' : setup.environment.dev.started ? 'dev started' : 'dev requested');
	if (setup.seed?.requested) parts.push(setup.seed.mode === 'apply' ? 'seed applied' : 'seed planned');
	if (setup.auth?.required) parts.push(setup.auth.hasSession ? 'auth resolved' : 'auth missing');
	return parts.length > 0 ? parts.join(', ') : 'checked';
}

export function writeSceneJsonLine(context: Parameters<TreeseedCommandHandler>[1], payload: Record<string, unknown>) {
	context.write(JSON.stringify(payload), 'stdout');
}

export function renderMode(value: unknown): TreeseedSceneRenderMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (['demo', 'training', 'failure-review', 'chapter', 'diagram-only'].includes(value)) return value as TreeseedSceneRenderMode;
	return undefined;
}

export function executionMode(value: unknown): TreeseedSceneExecutionMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (['acceptance', 'demo', 'training', 'record-only'].includes(value)) return value as TreeseedSceneExecutionMode;
	return undefined;
}

export function sceneDevice(value: unknown): TreeseedSceneDeviceProfileId | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function sceneDevices(value: unknown): TreeseedSceneDeviceProfileId[] | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function sceneRoles(value: unknown): TreeseedSceneVisualAuditRole[] | undefined {
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

export function sceneReviewDetail(value: unknown): TreeseedSceneVisualAuditReviewDetail | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	if (['summary', 'standard', 'full'].includes(value)) return value as TreeseedSceneVisualAuditReviewDetail;
	return undefined;
}

export function sceneMaxFindings(value: unknown): number | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function trainingFormats(value: unknown): TreeseedSceneTrainingOutputFormat[] | undefined {
	if (typeof value !== 'string') return undefined;
	const formats = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['json', 'markdown', 'vtt', 'srt']);
	return formats.filter((format): format is TreeseedSceneTrainingOutputFormat => allowed.has(format));
}

export function evidenceTarget(value: unknown): TreeseedSceneEvidenceTarget | undefined {
	if (typeof value !== 'string') return undefined;
	if (['local', 'ci', 'release'].includes(value)) return value as TreeseedSceneEvidenceTarget;
	return undefined;
}

export function evidenceBundlePolicy(value: unknown): TreeseedSceneEvidenceBundlePolicy | undefined {
	if (typeof value !== 'string') return undefined;
	if (['metadata-only', 'sanitized'].includes(value)) return value as TreeseedSceneEvidenceBundlePolicy;
	return undefined;
}

export function publishTarget(value: unknown): TreeseedScenePublishTarget | undefined {
	if (typeof value !== 'string') return undefined;
	if (['local', 'release'].includes(value)) return value as TreeseedScenePublishTarget;
	return undefined;
}

export function externalPublishTargets(value: unknown): TreeseedSceneExternalPublishTarget[] | undefined | null {
	if (typeof value !== 'string') return undefined;
	const targets = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	const allowed = new Set(['docs', 'training', 'release-evidence', 'artifact-store']);
	if (targets.some((target) => !allowed.has(target))) return null;
	return targets as TreeseedSceneExternalPublishTarget[];
}

