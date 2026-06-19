import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, renderWorkflowNextSteps, workflowErrorResult } from './workflow.js';

function packageArgs(value: unknown) {
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
	return typeof value === 'string' ? [value] : [];
}

export const handleReleaseCandidate: TreeseedCommandHandler = async (invocation, context) => {
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
			plan: invocation.args.plan === true || invocation.args.dryRun === true,
			dryRun: invocation.args.dryRun === true,
		});
		const payload = result.payload as {
			mode?: string;
			verifyDriver?: string;
			selectedPackageNames?: string[];
			proof?: {
				status?: string;
				proofId?: string;
				graph?: { order?: string[] };
				artifacts?: Array<{ packageId?: string; status?: string }>;
				actionChecks?: Array<{ packageId?: string; status?: string }>;
				failures?: Array<{ scope?: string; message?: string }>;
			};
			graph?: { order?: string[] };
			failures?: Array<{ scope?: string; message?: string }>;
		};
		const proof = payload.proof;
		const failures = proof?.failures ?? payload.failures ?? [];
		return guidedResult({
			command: invocation.commandName || 'release-candidate',
			summary: result.executionMode === 'plan'
				? 'Treeseed release-candidate rehearsal plan ready.'
				: 'Treeseed local release graph rehearsal passed.',
			facts: [
				{ label: 'Mode', value: payload.mode ?? 'strict' },
				{ label: 'Verify driver', value: payload.verifyDriver ?? 'auto' },
				{ label: 'Proof', value: proof?.proofId?.slice(0, 12) ?? (result.executionMode === 'plan' ? 'planned' : 'unknown') },
				{ label: 'Graph order', value: (proof?.graph?.order ?? payload.graph?.order ?? []).join(', ') || 'none' },
				{ label: 'Artifacts', value: String(proof?.artifacts?.length ?? 0) },
				{ label: 'Action checks', value: String(proof?.actionChecks?.length ?? 0) },
				{ label: 'Failures', value: String(failures.length) },
			],
			sections: failures.length > 0 ? [{
				title: 'Failures',
				lines: failures.map((failure) => `- ${failure.scope ?? 'unknown'}: ${failure.message ?? 'failed'}`),
			}] : [],
			nextSteps: renderWorkflowNextSteps(result),
			report: result,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};

