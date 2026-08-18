import type { CommandHandler } from '../../types.js';
import { guidedResult } from '../utilities/utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from '../operations/workflow.js';

function packageArgs(value: unknown) {
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
	return typeof value === 'string' ? [value] : [];
}

export const handleReleaseCandidate: CommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context, {
			write: context.outputFormat === 'json'
				? ((output: string) => context.write(output, 'stderr'))
				: context.write,
		}).releaseCandidate({
			mode: invocation.args.strict === true
				? 'strict'
				: typeof invocation.args.mode === 'string' ? invocation.args.mode as 'hybrid' | 'strict' | 'skip' : 'strict',
			verifyDriver: typeof invocation.args.verifyDriver === 'string'
				? invocation.args.verifyDriver as 'auto' | 'local' | 'action'
				: invocation.args.skipAction === true ? 'local' : 'auto',
			package: packageArgs(invocation.args.package),
			keepWorkspace: invocation.args.keepWorkspace === true,
			plan: invocation.args.plan === true,
		});
		const payload = result.payload as {
			mode?: string;
			driver?: string;
			verifyDriver?: string;
			selectedPackageNames?: string[];
			plan?: { subjects?: unknown[]; summary?: { reusable?: number; pending?: number } };
			proof?: {
				ok?: boolean;
				records?: unknown[];
				reused?: unknown[];
				failures?: Array<{ subject?: { id?: string }; invalidationReasons?: string[]; status?: string }>;
			};
			failures?: Array<{ subject?: { id?: string }; invalidationReasons?: string[]; status?: string }>;
		};
		const proof = payload.proof;
		const failures = proof?.failures ?? payload.failures ?? [];
		return guidedResult({
			command: invocation.commandName || 'release-candidate',
			summary: result.executionMode === 'plan'
				? 'Treeseed release-candidate proof plan ready.'
				: 'Treeseed release-candidate proof passed.',
			facts: [
				{ label: 'Mode', value: payload.mode ?? 'strict' },
				{ label: 'Driver', value: payload.driver ?? 'github-hosted' },
				{ label: 'Verify driver', value: payload.verifyDriver ?? 'auto' },
				{ label: 'Proof subjects', value: String(payload.plan?.subjects?.length ?? 0) },
				{ label: 'Reusable', value: String(proof?.reused?.length ?? payload.plan?.summary?.reusable ?? 0) },
				{ label: 'Executed', value: String(proof?.records?.length ?? 0) },
				{ label: 'Failures', value: String(failures.length) },
			],
			sections: failures.length > 0 ? [{
				title: 'Failures',
				lines: failures.map((failure) => `- ${failure.subject?.id ?? 'unknown'}: ${failure.invalidationReasons?.[0] ?? failure.status ?? 'failed'}`),
			}] : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
