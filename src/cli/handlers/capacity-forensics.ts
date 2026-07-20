export interface CapacityForensicsClient {
	request<T>(path: string, options?: { requireAuth?: boolean }): Promise<T>;
	projectAgentModeRuns?(projectId: string, options?: { assignmentId?: string | null }): Promise<{ payload?: unknown }>;
}

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function items(payload: unknown): Row[] {
	const values = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
	return values.filter(isRecord);
}

function value(row: Row, ...keys: string[]): unknown {
	for (const key of keys) {
		if (row[key] !== undefined && row[key] !== null) return row[key];
	}
	return undefined;
}

function timestamp(value: unknown): number {
	const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : 0;
}

function query(filters: Record<string, string | number | null>) {
	const params = new URLSearchParams();
	for (const [key, filter] of Object.entries(filters)) {
		if (filter !== null && filter !== '') params.set(key, String(filter));
	}
	return params.size > 0 ? `?${params}` : '';
}

export async function fetchExecutionRunsForAssignments(
	client: CapacityForensicsClient,
	teamId: string,
	assignmentIds: string[],
): Promise<Row[]> {
	const pages = await Promise.all(assignmentIds.map(async (assignmentId) => {
		const response = await client.request<{ ok: true; payload: unknown }>(
			`/v1/teams/${encodeURIComponent(teamId)}/capacity/execution-runs${query({ assignmentId, limit: 50 })}`,
			{ requireAuth: true },
		);
		return items(response.payload);
	}));
	return pages.flat();
}

export async function fetchWorkdayAssignmentIdsForLog(
	client: CapacityForensicsClient,
	teamId: string,
	workdayId: string,
	providerId: string | null,
): Promise<string[]> {
	const response = await client.request<{ ok: true; payload: unknown }>(
		`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments${query({ providerId, workdayId, limit: 200 })}`,
		{ requireAuth: true },
	);
	return items(response.payload)
		.filter((assignment) => String(value(assignment, 'workDayId', 'workdayId') ?? '') === workdayId)
		.sort((a, b) => timestamp(value(a, 'assignedAt', 'createdAt')) - timestamp(value(b, 'assignedAt', 'createdAt')))
		.map((assignment) => String(assignment.id ?? '').trim())
		.filter(Boolean);
}

export async function fetchProjectModeRunsForAssignment(
	client: CapacityForensicsClient,
	projectId: string,
	assignmentId: string,
): Promise<Row[]> {
	if (!client.projectAgentModeRuns) throw new Error('Project mode-run client operation is unavailable.');
	const response = await client.projectAgentModeRuns(projectId, { assignmentId });
	return items(response.payload).sort((a, b) =>
		timestamp(value(a, 'createdAt')) - timestamp(value(b, 'createdAt')),
	);
}
