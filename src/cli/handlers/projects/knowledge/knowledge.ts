import { randomUUID } from 'node:crypto';
import type { CommandHandler, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';

type Row = Record<string, unknown>;
function text(invocation: ParsedInvocation, name: string) { const value = invocation.args[name]; return typeof value === 'string' && value.trim() ? value.trim() : null; }
function flag(invocation: ParsedInvocation, name: string) { return invocation.args[name] === true; }
function simulation(invocation: ParsedInvocation) {
	if (!flag(invocation, 'simulateHuman')) return null; const workdayId = text(invocation, 'workday'); const reason = text(invocation, 'reason');
	if (!workdayId || !reason) throw new Error('Simulated-human editorial actions require --workday and --reason.');
	return { interactionMode: 'ai_operator_simulation', operatorPrincipalId: null, modelProvider: 'openai', clientSurface: 'trsd-cli', workdayId, assignmentId: text(invocation, 'assignment'), reason, simulationPurpose: text(invocation, 'simulationPurpose') ?? 'Live editorial workflow testing', productionAuthorityRequested: flag(invocation, 'production') };
}
function version(invocation: ParsedInvocation) { const value = Number(text(invocation, 'version')); if (!Number.isInteger(value) || value < 1) throw new Error('--version must be a positive integer.'); return value; }
function editorialResult(invocation: ParsedInvocation) {
	const supplied = text(invocation, 'result'); if (supplied) { const parsed = JSON.parse(supplied); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--result must be a JSON object.'); return parsed as Row; }
	const kind = text(invocation, 'kind'); const disposition = text(invocation, 'disposition');
	return { kind, disposition, criteria: [{ id: `${kind ?? 'editorial'}-review`, status: disposition === 'approved' ? 'pass' : 'fail', notes: text(invocation, 'notes') ?? undefined }], notes: text(invocation, 'notes') };
}

export const handleKnowledge: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0]; if (!action) return fail('Use `trsd knowledge <action>`.');
	if (['review-decide', 'review-publish'].includes(action) && !flag(invocation, 'yes')) return fail(`${action} is binding and requires --yes.`);
	try {
		const { client } = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
		const project = text(invocation, 'project'); const team = text(invocation, 'team'); const workspace = text(invocation, 'workspace'); const review = text(invocation, 'review'); const comment = text(invocation, 'comment');
		const provenance = simulation(invocation); let path = ''; let method = 'GET'; let body: Row | undefined;
		if (action === 'workspace-create') { if (!project) return fail('workspace-create requires --project.'); path = `/v1/projects/${encodeURIComponent(project)}/knowledge/workspaces`; method = 'POST'; body = { requestId: randomUUID(), simulation: provenance }; }
		else if (action === 'workspace-status') { if (!workspace) return fail('workspace-status requires --workspace.'); path = `/v1/knowledge/workspaces/${encodeURIComponent(workspace)}`; }
		else if (action === 'review-submit') { if (!workspace) return fail('review-submit requires --workspace.'); path = `/v1/knowledge/workspaces/${encodeURIComponent(workspace)}/submit`; method = 'POST'; body = { version: version(invocation), message: text(invocation, 'message'), notes: text(invocation, 'notes'), contextDigest: text(invocation, 'contextDigest'), simulation: provenance }; }
		else if (action === 'review-show') { if (!team) return fail('review-show requires --team.'); path = `/v1/teams/${encodeURIComponent(team)}/knowledge/reviews`; }
		else if (action === 'review-comment') { if (!review) return fail('review-comment requires --review.'); path = `/v1/knowledge/reviews/${encodeURIComponent(review)}/comments`; method = 'POST'; body = { path: text(invocation, 'path'), body: text(invocation, 'message'), simulation: provenance }; }
		else if (action === 'review-resolve') { if (!comment) return fail('review-resolve requires --comment.'); path = `/v1/knowledge/review-comments/${encodeURIComponent(comment)}/resolve`; method = 'POST'; body = { version: version(invocation), simulation: provenance }; }
		else if (action === 'editorial-review') { if (!review) return fail('editorial-review requires --review.'); path = `/v1/knowledge/reviews/${encodeURIComponent(review)}/editorial-results`; method = 'POST'; body = { result: editorialResult(invocation), simulation: provenance }; }
		else if (action === 'review-decide') { if (!review) return fail('review-decide requires --review.'); path = `/v1/knowledge/reviews/${encodeURIComponent(review)}/decision`; method = 'POST'; body = { version: version(invocation), decision: text(invocation, 'decision'), notes: text(invocation, 'notes') ?? text(invocation, 'reason'), simulation: provenance }; }
		else if (action === 'review-publish') { if (!review) return fail('review-publish requires --review.'); path = `/v1/knowledge/reviews/${encodeURIComponent(review)}/publish`; method = 'POST'; body = { simulation: provenance }; }
		else if (action === 'publication-status') { if (!team) return fail('publication-status requires --team.'); path = `/v1/teams/${encodeURIComponent(team)}/knowledge/publication-status`; }
		else return fail(`Unknown knowledge action ${action}.`);
		const response = await client.request(path, { method, body, headers: method === 'GET' ? undefined : { 'Idempotency-Key': `knowledge:${action}:${randomUUID()}` } });
		return guidedResult({ command: `knowledge ${action}`, summary: `Knowledge ${action} completed.`, facts: [{ label: 'Action', value: action }], report: { action, simulation: provenance, response } });
	} catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
};
