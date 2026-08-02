import type { CommandContext } from '../../../../types.js';
import { capacityMarketRequest, capacityRecordValue, isCapacityRecord } from '../../capacity-core/capacity-values.js';

type Row = Record<string, unknown>;

function items(value: unknown): Row[] {
	const payload = isCapacityRecord(value) ? capacityRecordValue(value, 'payload') : null;
	const entries = isCapacityRecord(payload) ? capacityRecordValue(payload, 'items') : null;
	return Array.isArray(entries) ? entries.filter(isCapacityRecord) : [];
}

function timeline(event: Row) {
	const timestamp = String(event.timestamp ?? '');
	const agent = String(event.agentId ?? event.agentClassId ?? 'control-plane');
	const type = String(event.eventType ?? 'activity');
	const summary = String(event.summary ?? '').replace(/\s+/gu, ' ').trim();
	return `${timestamp} | ${agent} | ${type} | ${summary}`;
}

export async function followWorkdayActivity(input: {
	client: unknown; teamId: string; workdayId: string; context: CommandContext; jsonl: boolean;
	agents: string | null; agentClasses: string | null; types: string | null; severity: string | null;
}) {
	let after = -1; let interrupted = false; let emptyAfterTerminal = 0;
	const stop = () => { interrupted = true; };
	process.once('SIGINT', stop);
	try {
		while (!interrupted) {
			const query = new URLSearchParams({ after: String(after), limit: '200' });
			if (input.agents) query.set('agent', input.agents);
			if (input.agentClasses) query.set('agentClass', input.agentClasses);
			if (input.types) query.set('type', input.types);
			if (input.severity) query.set('severity', input.severity);
			const activity = await capacityMarketRequest(input.client, `/v1/teams/${encodeURIComponent(input.teamId)}/workday-runs/${encodeURIComponent(input.workdayId)}/activity?${query}`, { requireAuth: true });
			const events = items(activity);
			for (const event of events) {
				after = Math.max(after, Number(event.sequence ?? after));
				await Promise.resolve(input.context.write(`${input.jsonl ? JSON.stringify(event) : timeline(event)}\n`));
			}
			const statusResponse = await capacityMarketRequest(input.client, `/v1/teams/${encodeURIComponent(input.teamId)}/workday-runs/${encodeURIComponent(input.workdayId)}`, { requireAuth: true });
			const statusPayload = isCapacityRecord(statusResponse) ? capacityRecordValue(statusResponse, 'payload') : null;
			const run = isCapacityRecord(statusPayload) ? capacityRecordValue(statusPayload, 'run') : null;
			const terminal = isCapacityRecord(run) && ['completed', 'cancelled', 'failed', 'degraded'].includes(String(run.status));
			emptyAfterTerminal = terminal && events.length === 0 ? emptyAfterTerminal + 1 : 0;
			if (emptyAfterTerminal >= 2) break;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
	} finally {
		process.removeListener('SIGINT', stop);
	}
	return { after, interrupted };
}
