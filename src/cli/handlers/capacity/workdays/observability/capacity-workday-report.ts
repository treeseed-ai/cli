import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CommandContext } from '../../../../types.js';

function sleep(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}


export async function holdWorkdayOpen(input: {
	runId: string;
	durationSeconds: number;
	event(body: Record<string, unknown>): Promise<void>;
}) {
	const durationMs = Math.max(0, Math.floor(input.durationSeconds * 1000));
	const startedAt = new Date().toISOString();
	const deadline = Date.now() + durationMs;
	const deadlineAt = new Date(deadline).toISOString();
	await input.event({
		eventType: 'workday.duration.started',
		status: 'recorded',
		title: `Timed workday observation started for ${input.durationSeconds}s`,
		context: { durationSeconds: input.durationSeconds, startedAt, deadlineAt },
	});
	while (Date.now() < deadline) {
		await sleep(Math.min(15_000, Math.max(250, deadline - Date.now())));
	}
	const completedAt = new Date().toISOString();
	await input.event({
		eventType: 'workday.duration.completed',
		status: 'recorded',
		title: 'Timed workday observation completed',
		context: { durationSeconds: input.durationSeconds, startedAt, deadlineAt, completedAt },
	});
	return { startedAt, deadlineAt, completedAt };
}

export function capacityWorkdayScore(input: {
	expectedProjects: string[];
	actualProjects: Array<Record<string, unknown>>;
	providerReady: boolean;
	auditEvents: number;
	planningOnly: boolean;
}) {
	const bySlug = new Map(input.actualProjects.map((project) => [String(project.slug ?? project.projectId), project]));
	const expected = input.expectedProjects;
	const projectCoverage = expected.filter((slug) => bySlug.has(slug)).length;
	const agentCoverage = expected.filter((slug) => Number(bySlug.get(slug)?.agentCount ?? 0) > 0).length;
	const expectedPlanningRunsForProject = (project: Record<string, unknown> | undefined) => Number(project?.agentCount ?? 0);
	const planningCoverage = expected.filter((slug) => {
		const project = bySlug.get(slug);
		return Number(project?.planningRuns ?? 0) >= expectedPlanningRunsForProject(project);
	}).length;
	const contentCoverage = expected.filter((slug) => Number(bySlug.get(slug)?.contentArtifacts ?? 0) > 0).length;
	const actingExpected = input.planningOnly
		? 0
		: expected.filter((slug) => Number(bySlug.get(slug)?.actingAssignments ?? 0) > 0).length;
	const actingCoverage = actingExpected === 0
		? 0
		: expected.filter((slug) => Number(bySlug.get(slug)?.actingRuns ?? 0) > 0 || Number(bySlug.get(slug)?.outputs ?? 0) > 0).length;
	const checks = [
		{ name: 'projectCoverage', actual: projectCoverage, expected: expected.length },
		{ name: 'agentCoverage', actual: agentCoverage, expected: expected.length },
		{ name: 'planningCoverage', actual: planningCoverage, expected: expected.length },
		{ name: 'contentArtifactCoverage', actual: contentCoverage, expected: expected.length },
		{ name: 'actingCoverage', actual: actingCoverage, expected: actingExpected },
		{ name: 'auditCompleteness', actual: input.auditEvents > 0 ? 1 : 0, expected: 1 },
		{ name: 'providerHealth', actual: input.providerReady ? 1 : 0, expected: 1 },
	].map((check) => ({
		...check,
		score: check.expected === 0 ? 100 : Math.round(Math.max(0, Math.min(1, check.actual / check.expected)) * 100),
	}));
	const blockers = [
		...(input.providerReady ? [] : ['local provider readiness was not proven']),
		...(input.auditEvents > 0 ? [] : ['audit event trail is empty']),
		...input.actualProjects.flatMap((project) => Array.isArray(project.blockers) ? (project.blockers as unknown[]).map((blocker) => `${project.slug}: ${String(blocker)}`) : []),
	];
	const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
	return {
		score,
		status: blockers.length === 0 && score >= 90 ? 'completed' : score >= 60 ? 'degraded' : 'failed',
		checks,
		blockers,
	};
}

export async function writeWorkdayRunReportFiles(context: CommandContext, input: {
	runId: string;
	reportDir: string;
	parameters: Record<string, unknown>;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	metrics: Record<string, unknown>;
}) {
	const reportDir = resolve(context.cwd, input.reportDir);
	await mkdir(reportDir, { recursive: true });
	const jsonPath = resolve(reportDir, `workday-${input.runId}.json`);
	const markdownPath = resolve(reportDir, `workday-${input.runId}.md`);
	await writeFile(jsonPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');
	const checks = Array.isArray(input.metrics.checks) ? input.metrics.checks as Array<Record<string, unknown>> : [];
	const blockers = Array.isArray(input.metrics.blockers) ? input.metrics.blockers as unknown[] : [];
	const actualProjects = Array.isArray(input.actual.projects) ? input.actual.projects as Array<Record<string, unknown>> : [];
	const diagnosticLines = actualProjects.flatMap((project) => {
		const diagnostics = Array.isArray(project.leaseDiagnostics) ? project.leaseDiagnostics as Array<Record<string, unknown>> : [];
		return diagnostics.map((diagnostic) => {
			const reasons = Array.isArray(diagnostic.reasons) ? diagnostic.reasons.join(', ') : String(diagnostic.reasons ?? 'unknown');
			return `- ${String(project.slug ?? project.projectId)} / ${String(diagnostic.assignmentId ?? 'assignment')}: ${reasons || 'no recorded reasons'}`;
		});
	});
	await writeFile(markdownPath, `${[
		`# Workday ${input.runId}`,
		'',
		`Status: ${String(input.metrics.status ?? 'unknown')}`,
		`Score: ${String(input.metrics.score ?? 'n/a')}`,
		`Purpose: ${String(input.parameters.purpose ?? 'portfolio planning')}`,
		`Provider: ${String(input.parameters.providerId ?? 'local')}`,
		'',
		'## Coverage',
		'',
		...checks.map((check) => `- ${String(check.name)}: ${String(check.actual)}/${String(check.expected)} (${String(check.score)})`),
		'',
		'## Projects',
		'',
		...actualProjects.map((project) => `- ${String(project.slug ?? project.projectId)}: ${String(project.status ?? 'unknown')}; agents=${String(project.agentCount ?? 0)}; planning=${String(project.planningRuns ?? 0)}; acting=${String(project.actingRuns ?? 0)}; assignments=${String(project.assignments ?? 0)}`),
		'',
		'## Blockers',
		'',
		...(blockers.length ? blockers.map((blocker) => `- ${String(blocker)}`) : ['- none']),
		'',
		'## Lease Diagnostics',
		'',
		...(diagnosticLines.length ? diagnosticLines : ['- none']),
	].join('\n')}\n`, 'utf8');
	return { jsonPath, markdownPath };
}

