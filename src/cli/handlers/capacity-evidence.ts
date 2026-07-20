import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { TreeseedCommandContext, TreeseedParsedInvocation } from '../types.js';
import { createMarketClientForInvocation } from './market-utils.js';
import { fail, guidedResult } from './utils.js';
import { capacityStringArg as text } from './capacity-command-arguments.js';
import { capacityAuthenticatedMarketRequest as request } from './capacity-values.js';

export const CAPACITY_EVIDENCE_ACTIONS = new Set([
	'assignment',
	'assignment-explanation',
	'reservations',
	'reservation-explanation',
	'usage',
	'usage-export',
	'ledger',
	'ledger-export',
]);

function pageQuery(invocation: TreeseedParsedInvocation) {
	const projectId = text(invocation, 'project');
	if (!projectId) return { error: 'Missing --project for capacity evidence inspection.' };
	const query = new URLSearchParams({ projectId });
	const workdayId = text(invocation, 'workday');
	const limit = text(invocation, 'limit');
	const cursor = text(invocation, 'cursor');
	if (workdayId) query.set('workDayId', workdayId);
	if (limit) query.set('limit', limit);
	if (cursor) query.set('cursor', cursor);
	return { query };
}

async function writeExport(invocation: TreeseedParsedInvocation, context: TreeseedCommandContext, payload: unknown) {
	const file = text(invocation, 'file');
	if (!file) return null;
	const outputPath = resolve(context.cwd, file);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
	return outputPath;
}

export async function runCapacityEvidenceAction(
	action: string,
	invocation: TreeseedParsedInvocation,
	context: TreeseedCommandContext,
) {
	const teamId = text(invocation, 'team');
	if (!teamId) return fail(`Missing --team for capacity ${action}.`);
	const exportAction = action.endsWith('-export');
	if (exportAction && !text(invocation, 'file')) return fail(`Capacity ${action} requires --file <path>.`);
	const team = encodeURIComponent(teamId);
	let path: string;
	if (action === 'assignment' || action === 'assignment-explanation') {
		const assignmentId = text(invocation, 'assignment');
		if (!assignmentId) return fail(`Missing --assignment for capacity ${action}.`);
		path = `/v1/teams/${team}/capacity/assignments/${encodeURIComponent(assignmentId)}${action.endsWith('explanation') ? '/explanation' : ''}`;
	} else if (action === 'reservation-explanation') {
		const reservationId = text(invocation, 'reservation');
		if (!reservationId) return fail('Missing --reservation for capacity reservation-explanation.');
		path = `/v1/teams/${team}/capacity/reservations/${encodeURIComponent(reservationId)}/explanation`;
	} else {
		const parsed = pageQuery(invocation);
		if (parsed.error) return fail(parsed.error);
		const collection = action.startsWith('reservation') ? 'reservations' : action.startsWith('usage') ? 'usage' : 'ledger';
		path = `/v1/teams/${team}/capacity/${collection}?${parsed.query}`;
	}
	const { profile, client } = createMarketClientForInvocation(invocation, context, {
		requireAuth: true,
		allowLocalAcceptanceAdmin: true,
	});
	const response = await request<{ ok: boolean; payload: unknown }>(client, path);
	const outputPath = exportAction ? await writeExport(invocation, context, response.payload) : null;
	return guidedResult({
		command: `capacity ${action}`,
		summary: outputPath ? `Exported capacity ${action.replace('-export', '')} evidence.` : `Read capacity ${action} evidence.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Output', value: outputPath },
		],
		report: { action, teamId, outputPath, payload: response.payload },
	});
}
