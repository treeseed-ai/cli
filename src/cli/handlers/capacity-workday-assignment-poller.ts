export interface CapacityWorkdayAssignmentState {
	projectId: string;
	workdayId: string | null;
	assignmentIds: string[];
}

export interface CapacityWorkdayAssignmentClient {
	capacityProviderAssignments(teamId: string, options: {
		projectId: string;
		providerId: string;
		workdayId: string | null;
		view: 'lifecycle';
		limit: number;
		cursor: string | null;
	}): Promise<{
		payload?: {
			items?: unknown[];
			page?: { hasMore?: boolean; nextCursor?: string | null };
		};
	}>;
}

export function isUnfinishedCapacityWorkdayAssignment(assignment: unknown) {
	const row = record(assignment);
	const status = String(row.status ?? '').toLowerCase();
	const leaseState = String(row.leaseState ?? '').toLowerCase();
	if (['completed', 'failed', 'returned', 'expired', 'cancelled'].includes(status)) return false;
	return !(status === 'completed' && leaseState === 'released');
}

export async function fetchCapacityWorkdayAssignments(
	client: CapacityWorkdayAssignmentClient,
	teamId: string,
	projectStates: CapacityWorkdayAssignmentState[],
	providerId: string,
	runId: string,
) {
	const entries = await Promise.all(projectStates.map(async (projectState) => {
		const assignments: unknown[] = [];
		let cursor: string | null = null;
		do {
			const response = await client.capacityProviderAssignments(teamId, {
				projectId: projectState.projectId,
				providerId,
				workdayId: projectState.workdayId,
				view: 'lifecycle',
				limit: 200,
				cursor,
			}).catch(() => ({ payload: { items: [] as unknown[], page: { hasMore: false, nextCursor: null } } }));
			assignments.push(...(Array.isArray(response.payload?.items) ? response.payload.items : []));
			cursor = response.payload?.page?.hasMore && response.payload.page.nextCursor
				? response.payload.page.nextCursor
				: null;
		} while (cursor);
		const matchingAssignments = assignments
			.map(record)
			.filter((assignment) => {
				const assignmentId = String(assignment.id ?? '');
				const metadata = record(assignment.metadata);
				const explanation = record(assignment.explanation);
				const synthesisKey = String(assignment.synthesisKey ?? '');
				return projectState.assignmentIds.includes(assignmentId)
					|| metadata.capacityWorkdayRunId === runId
					|| metadata.workdayRunId === runId
					|| explanation.runId === runId
					|| synthesisKey.startsWith(`workday:${runId}:`);
			});
		return [projectState.projectId, matchingAssignments] as const;
	}));
	return new Map(entries);
}

export async function waitForCapacityWorkdayAssignments(
	client: CapacityWorkdayAssignmentClient,
	teamId: string,
	projectStates: CapacityWorkdayAssignmentState[],
	providerId: string,
	waitSeconds: number,
	runId: string,
	minimumAssignments = 1,
) {
	const deadline = Date.now() + waitSeconds * 1000;
	let snapshots = await fetchCapacityWorkdayAssignments(client, teamId, projectStates, providerId, runId);
	while (Date.now() < deadline) {
		const observed = [...snapshots.values()].flat();
		const unfinished = observed.filter(isUnfinishedCapacityWorkdayAssignment);
		if (observed.length >= minimumAssignments && unfinished.length === 0) {
			return { completed: true, snapshots, unfinished };
		}
		await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(500, deadline - Date.now()))));
		snapshots = await fetchCapacityWorkdayAssignments(client, teamId, projectStates, providerId, runId);
	}
	const unfinished = [...snapshots.values()].flat().filter(isUnfinishedCapacityWorkdayAssignment);
	return { completed: unfinished.length === 0, snapshots, unfinished };
}
import { capacityRecord as record } from './capacity-values.js';
