import type { CommandHandler } from '../../types.js';
import { guidedResult } from '../utilities/utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';

function proofAction(positionals: string[]) {
	const action = positionals[0];
	if (['plan', 'run', 'status', 'failures', 'explain', 'clean'].includes(String(action))) {
		return action as 'plan' | 'run' | 'status' | 'failures' | 'explain' | 'clean';
	}
	return undefined;
}

function proofSections(payload: Record<string, any>) {
	if (payload.action === 'failures') {
		const failures = Array.isArray(payload.failures) ? payload.failures : [];
		return [{
			title: 'Failures',
			lines: failures.length > 0
				? failures.map((record: Record<string, any>) => {
					const workflow = record.result?.workflow;
					return `- ${record.subject?.id ?? 'proof'} ${record.driver ?? 'driver'}: ${record.invalidationReasons?.[0] ?? record.status}${workflow?.url ? ` (${workflow.url})` : ''}`;
				})
				: ['No failed proof records.'],
		}];
	}
	if (payload.action === 'explain') {
		const slowest = Array.isArray(payload.slowest) ? payload.slowest : [];
		return [{
			title: 'Slowest proof records',
			lines: slowest.length > 0
				? slowest.map((entry: Record<string, any>) => `- ${entry.subject}: ${entry.durationMs ?? 0}ms (${entry.reason ?? entry.status ?? 'recorded'})`)
				: ['No proof timing records.'],
		}];
	}
	const plan = payload.plan;
	const subjects = Array.isArray(plan?.subjects) ? plan.subjects : [];
	if (subjects.length > 0) {
		return [{
			title: 'Proof subjects',
			lines: subjects.map((subject: Record<string, any>) => {
				const proof = subject.reusableProof ? 'reusable' : 'missing';
				const workflow = subject.workflow ? ` ${subject.workflow}` : '';
				return `- ${subject.subject?.id ?? 'proof'} ${subject.driver ?? ''}${workflow}: ${proof}`;
			}),
		}];
	}
	return [];
}

export const handleProof: CommandHandler = async (invocation, context) => {
	try {
		const action = proofAction(invocation.positionals) ?? 'status';
		const result = await createWorkflowSdk(context, {
			write: context.outputFormat === 'json'
				? ((output: string) => context.write(output, 'stderr'))
				: context.write,
		}).proof({
			action,
			target: typeof invocation.args.target === 'string' ? invocation.args.target as 'local' | 'staging' | 'prod' : undefined,
			driver: typeof invocation.args.driver === 'string' ? invocation.args.driver as 'github-hosted' | 'act' | 'local' | 'railway-live' | 'cloudflare-live' | 'reconcile-live' : undefined,
			subject: typeof invocation.args.subject === 'string' ? invocation.args.subject : null,
			last: invocation.args.last === true,
			olderThan: typeof invocation.args.olderThan === 'string' ? invocation.args.olderThan : null,
			plan: invocation.args.plan === true || action === 'plan',
		});
		const payload = result.payload as Record<string, any>;
		const timing = payload.timing;
		return guidedResult({
			command: invocation.commandName || 'proof',
			summary: result.summary ?? 'Treeseed release proof report ready.',
			facts: [
				{ label: 'Action', value: payload.action ?? action },
				{ label: 'Target', value: payload.target ?? 'staging' },
				{ label: 'Driver', value: payload.driver ?? payload.plan?.driver ?? 'github-hosted' },
				{ label: 'Authority', value: payload.authority ?? 'authoritative' },
				{ label: 'Started', value: timing?.startedAt ?? 'unknown' },
				{ label: 'Finished', value: timing?.finishedAt ?? 'unknown' },
				{ label: 'Duration ms', value: timing?.durationMs ?? 0 },
				{ label: 'Failures', value: String(payload.failures?.length ?? payload.summary?.failed ?? 0) },
			],
			sections: proofSections(payload),
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
