import type { MarketClient } from '@treeseed/sdk/market-client';
import { fetchProjectModeRunsForAssignment } from './capacity-forensics.js';
import { fetchCapacityWorkdayAssignments, isUnfinishedCapacityWorkdayAssignment } from './capacity-workday-assignment-poller.js';
import { executionRunsForAssignments } from './capacity-workday-log.js';
import { assignmentContentArtifacts, dedupeModeRunRecords, modeRunContentArtifacts, uniqueContentArtifacts } from './capacity-workday-log-records.js';
import { capacityRecordValue as recordValue } from './capacity-values.js';

export interface CapacityWorkdayProjectState {
  projectId: string; slug: string; workdayId: string | null;
  agentClasses: Array<Record<string, unknown>>; contentAgentCount: number;
  assignmentIds: string[]; assignmentCount: number; blockers: string[];
}

export async function collectCapacityWorkdayResults(input: {
  client: MarketClient; teamId: string; providerId: string; runId: string;
  projectStates: CapacityWorkdayProjectState[];
  waitedAssignmentSnapshots: Map<string, Record<string, unknown>[]> | null;
  waitTimedOutAssignmentIds: Set<string>;
  durationWindow: { startedAt: string; deadlineAt: string; completedAt: string } | null;
  completedDurationWorkdayIds: Set<string>;
  parameters: { mode: string; waitSeconds: number; planningOnly: boolean };
  event(body: Record<string, unknown>): Promise<void>;
}) {
  const { client, teamId, providerId, runId, projectStates, waitedAssignmentSnapshots, waitTimedOutAssignmentIds, durationWindow, completedDurationWorkdayIds, parameters, event } = input;
	const actualProjects: Array<Record<string, unknown>> = [];
	for (const projectState of projectStates) {
		const projectAssignments = waitedAssignmentSnapshots?.get(projectState.projectId)
			?? (await fetchCapacityWorkdayAssignments(client, teamId, [projectState], providerId, runId)).get(projectState.projectId)
			?? [];
		const projectAssignmentIds = projectAssignments.map((assignment) => String(assignment.id ?? '')).filter(Boolean);
		const actingAssignments = projectAssignments.filter((assignment) => String(recordValue(assignment, 'mode') ?? '').toLowerCase() === 'acting');
		const projectModeRuns = dedupeModeRunRecords((await Promise.all(projectAssignmentIds.map((assignmentId) =>
			fetchProjectModeRunsForAssignment(client, projectState.projectId, assignmentId),
		))).flat());
		const planningRuns = projectModeRuns.filter((run) => String(recordValue(run, 'mode') ?? '').toLowerCase() === 'planning');
		const actingRuns = projectModeRuns.filter((run) => String(recordValue(run, 'mode') ?? '').toLowerCase() === 'acting');
		const executionRuns = await executionRunsForAssignments(client, teamId, projectAssignmentIds);
		const pendingAssignments = projectAssignments.filter((assignment) => {
			return isUnfinishedCapacityWorkdayAssignment(assignment);
		});
		const durationBoundedPendingAssignments = durationWindow
			? pendingAssignments.filter((assignment) => {
				const leaseState = String(recordValue(assignment, 'leaseState') ?? '').toLowerCase();
				const status = String(recordValue(assignment, 'status') ?? '').toLowerCase();
				return !['leased', 'running', 'in_progress'].includes(leaseState)
					&& !['leased', 'running', 'in_progress'].includes(status);
			})
			: [];
		const activeUnfinishedAssignments = durationWindow
			? pendingAssignments.filter((assignment) => !durationBoundedPendingAssignments.includes(assignment))
			: pendingAssignments;
		const failedAssignments = projectAssignments.filter((assignment) => {
			const status = String(recordValue(assignment, 'status') ?? '').toLowerCase();
			const lifecycleCode = String(recordValue(assignment, 'lifecycleCode') ?? '').trim();
			if (['failed', 'returned', 'expired', 'cancelled'].includes(status)) return true;
			return Boolean(lifecycleCode) && !['completed', 'succeeded', 'success'].includes(status);
		});
		const leaseDiagnostics = (await Promise.all(pendingAssignments.map(async (assignment) => {
			const assignmentId = String(assignment.id ?? '');
			if (!assignmentId) return null;
			const explanation = await client.providerAssignmentExplanation(teamId, assignmentId).catch(() => null);
			const payload = explanation && typeof explanation === 'object' && 'payload' in explanation
				? (explanation as { payload?: unknown }).payload
				: explanation;
			return payload && typeof payload === 'object'
				? {
					assignmentId,
					status: assignment.status ?? null,
					leaseState: assignment.leaseState ?? null,
					reasons: recordValue(payload, 'reasons') ?? [],
					gates: recordValue(payload, 'gates') ?? {},
					metadata: recordValue(payload, 'metadata') ?? {},
				}
				: {
					assignmentId,
					status: assignment.status ?? null,
					leaseState: assignment.leaseState ?? null,
					reasons: ['lease_diagnostics_missing'],
					gates: {},
					metadata: {},
				};
		}))).filter(Boolean);
		if (activeUnfinishedAssignments.length > 0 && leaseDiagnostics.length === 0) {
			projectState.blockers.push(`${activeUnfinishedAssignments.length} active assignment(s) remained unfinished without lease diagnostics`);
		} else if (activeUnfinishedAssignments.length > 0) {
			const reasons = leaseDiagnostics.flatMap((diagnostic) => Array.isArray((diagnostic as Record<string, unknown>).reasons)
				? ((diagnostic as Record<string, unknown>).reasons as unknown[]).map(String)
				: []);
			const timedOutCount = activeUnfinishedAssignments.filter((assignment) => waitTimedOutAssignmentIds.has(String(assignment.id ?? ''))).length;
			projectState.blockers.push(`${activeUnfinishedAssignments.length} active assignment(s) remained unfinished${timedOutCount > 0 ? ` after ${parameters.waitSeconds}s` : ''}${reasons.length ? `: ${[...new Set(reasons)].join(', ')}` : ''}`);
		}
		const contentArtifacts = uniqueContentArtifacts([
			...projectAssignments.flatMap(assignmentContentArtifacts),
			...projectModeRuns.flatMap(modeRunContentArtifacts),
			...executionRuns.flatMap(modeRunContentArtifacts),
		]);
		const expectedPlanningRuns = projectState.contentAgentCount;
		if (parameters.mode === 'live' && expectedPlanningRuns > 0 && planningRuns.length < expectedPlanningRuns) {
			projectState.blockers.push(`planning portfolio incomplete: expected at least ${expectedPlanningRuns} planning run(s), observed ${planningRuns.length}`);
		}
		if (parameters.mode === 'live' && durationWindow && projectAssignmentIds.length > 0 && planningRuns.length === 0) {
			projectState.blockers.push('timed workday elapsed without any planning mode run telemetry');
		}
		if (parameters.mode === 'live' && projectAssignmentIds.length > 0 && projectModeRuns.length === 0) {
			projectState.blockers.push('created assignments did not produce assignment-scoped mode-run telemetry');
		}
		if (parameters.mode === 'live' && projectAssignments.length === 0) {
			projectState.blockers.push('API workday scheduling did not synthesize any provider assignments during the timed workday window');
		}
		if (parameters.mode === 'live' && projectAssignments.length > 0 && planningRuns.length === 0) {
			projectState.blockers.push('provider assignments did not produce planning mode runs');
		}
		if (parameters.mode === 'live' && projectModeRuns.length > 0 && executionRuns.length === 0) {
			projectState.blockers.push('mode runs did not appear in the execution-run audit projection');
		}
		if (parameters.mode === 'live' && failedAssignments.length > 0) {
			const reasons = failedAssignments.map((assignment) => {
				const id = String(recordValue(assignment, 'id') ?? 'assignment');
				const status = String(recordValue(assignment, 'status') ?? 'failed');
				const code = String(recordValue(assignment, 'lifecycleCode') ?? '').trim();
				const reason = String(recordValue(assignment, 'lifecycleReason') ?? '').trim();
				return [id, status, code || null, reason || null].filter(Boolean).join(' | ');
			});
			projectState.blockers.push(`terminal assignment failure: ${reasons.join('; ')}`);
		}
		if (parameters.mode === 'live' && projectAssignmentIds.length > 0 && contentArtifacts.length === 0) {
			projectState.blockers.push('completed workday did not produce durable content artifact refs');
		}
		const badTestArtifacts = contentArtifacts
			.map((artifact) => String(recordValue(artifact, 'contentPath') ?? ''))
			.filter((contentPath) => contentPath.split('/').some((part) => part.startsWith('workday-') && part.endsWith('tests')));
		if (badTestArtifacts.length > 0) {
			projectState.blockers.push(`agent content used non-production namespace: ${badTestArtifacts.join(', ')}`);
		}
		actualProjects.push({
			projectId: projectState.projectId,
			slug: projectState.slug,
			workdayId: projectState.workdayId,
			agentCount: projectState.contentAgentCount,
			agentClassCount: projectState.agentClasses.length,
			assignments: Math.max(projectState.assignmentCount, projectAssignments.length),
			actingAssignments: actingAssignments.length,
			pendingAssignments: pendingAssignments.length,
			durationBoundedPendingAssignments: durationBoundedPendingAssignments.length,
			activeUnfinishedAssignments: activeUnfinishedAssignments.length,
			durationWindow,
			leaseDiagnostics,
			planningRuns: planningRuns.length,
			actingRuns: actingRuns.length,
			executionRuns: executionRuns.length,
			executionRunRefs: executionRuns.map((run) => ({
				id: recordValue(run, 'id') ?? null,
				status: recordValue(run, 'status') ?? null,
				timing: recordValue(run, 'timing') ?? {},
				agent: recordValue(run, 'agent') ?? {},
				assignment: recordValue(run, 'assignment') ?? {},
				executionProvider: recordValue(run, 'executionProvider') ?? {},
				contentArtifactRefs: uniqueContentArtifacts(Array.isArray(recordValue(run, 'contentArtifactRefs')) ? recordValue(run, 'contentArtifactRefs') as unknown[] : []),
			})),
			contentArtifacts: contentArtifacts.length,
			contentArtifactRefs: contentArtifacts,
			status: projectState.blockers.length ? 'degraded' : 'ready',
			blockers: projectState.blockers,
		});
		if (projectState.workdayId && parameters.mode === 'live') {
			if (!completedDurationWorkdayIds.has(projectState.workdayId)) {
			await client.completeWorkday(projectState.workdayId, `workday-close:${runId}:${projectState.workdayId}:cleanup`).catch(() => null);
			await event({
				eventType: 'workday.completed',
				projectId: projectState.projectId,
				workdayId: projectState.workdayId,
				title: `Completed workday for ${projectState.slug}`,
			});
		}
	}
	}
  return actualProjects;
}
