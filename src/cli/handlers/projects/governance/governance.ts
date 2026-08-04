import { randomUUID } from 'node:crypto';
import type { CommandHandler, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';

type JsonRecord = Record<string, unknown>;

function text(invocation: ParsedInvocation, name: string) {
	const value = invocation.args[name];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function flag(invocation: ParsedInvocation, name: string) { return invocation.args[name] === true; }
function payload(value: unknown): JsonRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const record = value as JsonRecord;
	return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload as JsonRecord : record;
}
function simulation(invocation: ParsedInvocation): JsonRecord | null {
	if (!flag(invocation, 'simulateHuman')) return null;
	const workdayId = text(invocation, 'workday');
	const reason = text(invocation, 'reason');
	if (!workdayId || !reason) throw new Error('Simulated-human actions require --workday and --reason.');
	return {
		interactionMode: 'ai_operator_simulation', modelProvider: 'openai', clientSurface: 'trsd-cli',
		workdayId, assignmentId: text(invocation, 'assignment'), reason,
		simulationPurpose: text(invocation, 'simulationPurpose') ?? 'Live agent evolution testing',
		productionAuthorityRequested: flag(invocation, 'production'),
	};
}

const bindingActions = new Set(['proposal-vote', 'proposal-evaluate', 'proposal-admin-decide']);
const mutatingActions = new Set([
	'proposal-create', 'proposal-update', 'proposal-open', 'proposal-discuss', 'proposal-start-voting',
	'proposal-vote', 'proposal-evaluate', 'proposal-admin-decide', 'proposal-withdraw', 'proposal-supersede',
]);

export const handleGovernance: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0];
	const projectId = text(invocation, 'project');
	if (!action || !projectId) return fail('Use `trsd governance <action> --project <project-id>`.');
	if (bindingActions.has(action) && !flag(invocation, 'yes')) return fail(`${action} is binding and requires --yes.`);
	let market;
	try { market = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true }); }
	catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	const proposalId = text(invocation, 'proposal');
	const decisionId = text(invocation, 'decision');
	const proposalPath = proposalId ? `/v1/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}` : null;
	try {
		const provenance = simulation(invocation);
		const idempotencyKey = text(invocation, 'idempotencyKey') ?? `governance:${action}:${randomUUID()}`;
		const headers = { 'Idempotency-Key': idempotencyKey };
		let response: unknown;
		if (action === 'proposal-list') response = await market.client.request(`/v1/projects/${encodeURIComponent(projectId)}/proposals?limit=${encodeURIComponent(text(invocation, 'limit') ?? '50')}${text(invocation, 'status') ? `&status=${encodeURIComponent(text(invocation, 'status')!)}` : ''}`);
		else if (action === 'proposal-show' || action === 'proposal-events') {
			if (!proposalPath) return fail('This action requires --proposal.');
			response = await market.client.request(`${proposalPath}${action === 'proposal-events' ? '/events' : ''}`);
		} else if (action === 'decision-list') response = await market.client.request(`/v1/projects/${encodeURIComponent(projectId)}/decisions?limit=${encodeURIComponent(text(invocation, 'limit') ?? '50')}`);
		else if (action === 'decision-show' || action === 'decision-events') {
			if (!decisionId) return fail('This action requires --decision.');
			response = await market.client.request(`/v1/projects/${encodeURIComponent(projectId)}/decisions/${encodeURIComponent(decisionId)}${action === 'decision-events' ? '/events' : ''}`);
		} else {
			if (!mutatingActions.has(action)) return fail(`Unknown governance action ${action}.`);
			let current: JsonRecord = {};
			if (proposalPath) current = payload(await market.client.request(proposalPath));
			const expectedProposalVersion = Number(current.activeVersion ?? 0) || undefined;
			let method = 'POST';
			let path = `/v1/projects/${encodeURIComponent(projectId)}/proposals`;
			let body: JsonRecord = { simulation: provenance, expectedProposalVersion };
			if (action === 'proposal-create') body = {
				title: text(invocation, 'title'), summary: text(invocation, 'summary'), body: text(invocation, 'body'),
				proposalType: text(invocation, 'proposalType') ?? 'editorial', metadata: { simulation: provenance },
			};
			else {
				if (!proposalPath) return fail('This action requires --proposal.');
				path = proposalPath;
				if (action === 'proposal-update') { method = 'PATCH'; body = { ...body, title: text(invocation, 'title'), summary: text(invocation, 'summary'), body: text(invocation, 'body') }; }
				if (action === 'proposal-open') { path += '/open'; body.reason = text(invocation, 'reason'); }
				if (action === 'proposal-discuss') { path += '/discussion'; body = { ...body, kind: text(invocation, 'kind'), message: text(invocation, 'message'), contentContributorRef: text(invocation, 'contributor'), automatedEvolutionTest: Boolean(provenance) }; }
				if (action === 'proposal-start-voting') { path += '/start-voting'; body.reason = text(invocation, 'reason'); }
				if (action === 'proposal-vote') { path += '/vote'; body = { ...body, vote: text(invocation, 'vote'), reason: text(invocation, 'reason') }; }
				if (action === 'proposal-evaluate') path += '/evaluate';
				if (action === 'proposal-admin-decide') {
					path += '/admin-decision';
					body.status = text(invocation, 'status') ?? 'approved';
					body.reason = text(invocation, 'reason');
				}
				if (action === 'proposal-withdraw') { path += '/withdraw'; body.reason = text(invocation, 'reason'); }
				if (action === 'proposal-supersede') { path += '/supersede'; body.reason = text(invocation, 'reason'); }
			}
			response = await market.client.request(path, { method, body, headers });
		}
		const result = payload(response);
		return guidedResult({
			command: `governance ${action}`,
			summary: `Governance ${action} completed for project ${projectId}.`,
			facts: [
				{ label: 'Project', value: projectId },
				{ label: 'Record', value: String(result.id ?? proposalId ?? decisionId ?? 'collection') },
				{ label: 'Status', value: String(result.status ?? 'available') },
			],
			report: { marketId: market.profile.id, action, projectId, simulation: provenance, result },
		});
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
};
