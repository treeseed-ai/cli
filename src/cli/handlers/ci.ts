import type { TreeseedCiResult } from '@treeseed/sdk/workflow';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createWorkflowSdk, workflowErrorResult } from './workflow.js';

function asStringArray(value: unknown) {
	return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];
}

function workflowLabel(repo: { name?: string; repository?: string | null }, workflow: { workflow?: string; state?: string; conclusion?: string | null; url?: string | null; inspectCommand?: string | null }) {
	const status = workflow.conclusion ?? workflow.state ?? 'unknown';
	return `- ${repo.name ?? repo.repository ?? 'repo'} ${workflow.workflow ?? 'workflow'}: ${status}${workflow.url ? ` (${workflow.url})` : ''}${workflow.inspectCommand ? `\n  Inspect: ${workflow.inspectCommand}` : ''}`;
}

function activeJobLines(workflow: { jobs?: Array<{ name?: string; status?: string | null; steps?: Array<{ name?: string; status?: string | null }> }> }) {
	const jobs = Array.isArray(workflow.jobs) ? workflow.jobs : [];
	return jobs
		.filter((job) => job.status && job.status !== 'completed')
		.slice(0, 3)
		.map((job) => {
			const step = Array.isArray(job.steps)
				? job.steps.find((entry) => entry.status && entry.status !== 'completed')
				: null;
			return `  Active: ${job.name ?? 'job'}${step?.name ? ` > ${step.name}` : ''}`;
		});
}

function failureLines(payload: TreeseedCiResult) {
	return payload.failures.flatMap((failure) => {
		const target = failure.jobName
			? `${failure.repoName} ${failure.workflow ?? 'workflow'} job ${failure.jobName}`
			: failure.workflow
				? `${failure.repoName} ${failure.workflow}`
				: failure.repoName;
		const lines = [
			`- ${target}: ${failure.message}`,
			...(failure.url ? [`  URL: ${failure.url}`] : []),
			...(failure.inspectCommand ? [`  Inspect: ${failure.inspectCommand}`] : []),
			...(failure.failedSteps.length > 0 ? [`  Failed steps: ${failure.failedSteps.map((step) => step.name).join(', ')}`] : []),
		];
		if (failure.logExcerpt) {
			lines.push('  Log excerpt:');
			lines.push(...failure.logExcerpt.split(/\r?\n/u).map((line) => `    ${line}`));
		}
		return lines;
	});
}

function pendingLines(payload: TreeseedCiResult) {
	return payload.repositories.flatMap((repo) =>
		repo.workflows
			.filter((workflow) => workflow.state === 'pending')
			.flatMap((workflow) => [
				workflowLabel(repo, workflow),
				...activeJobLines(workflow),
			]));
}

function missingOrNotPushedLines(payload: TreeseedCiResult) {
	const lines: string[] = [];
	for (const repo of payload.repositories) {
		if (repo.state === 'not_pushed' || repo.state === 'error') {
			lines.push(`- ${repo.name}: ${repo.message ?? repo.state}`);
			continue;
		}
		for (const workflow of repo.workflows.filter((entry) => entry.state === 'missing' || entry.state === 'error')) {
			lines.push(workflowLabel(repo, workflow));
		}
	}
	return lines;
}

function passingLines(payload: TreeseedCiResult) {
	return payload.repositories.flatMap((repo) =>
		repo.workflows
			.filter((workflow) => workflow.state === 'success')
			.map((workflow) => workflowLabel(repo, workflow)));
}

function ciSections(payload: TreeseedCiResult, failedOnly: boolean) {
	const sections = [
		{ title: 'Failures', lines: failureLines(payload) },
		{ title: 'Pending', lines: pendingLines(payload) },
		{ title: 'Missing / Not Pushed', lines: missingOrNotPushedLines(payload) },
	];
	if (!failedOnly) {
		sections.push({ title: 'Passing', lines: passingLines(payload) });
	}
	return sections;
}

export const handleCi: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const result = await createWorkflowSdk(context).ci({
			failed: invocation.args.failed === true,
			logs: invocation.args.logs === true,
			logLines: typeof invocation.args.logLines === 'string' ? invocation.args.logLines : undefined,
			scope: typeof invocation.args.scope === 'string' ? invocation.args.scope as 'workspace' | 'root' | 'packages' : undefined,
			workflows: asStringArray(invocation.args.workflow),
			branch: typeof invocation.args.branch === 'string' ? invocation.args.branch : undefined,
			strict: invocation.args.strict === true,
		});
		const payload = result.payload as TreeseedCiResult;
		return guidedResult({
			command: invocation.commandName || 'ci',
			summary: payload.hasFailures
				? 'Treeseed CI found remote GitHub Actions failures.'
				: payload.strict && payload.hasPending
					? 'Treeseed CI found pending remote GitHub Actions runs.'
					: 'Treeseed CI status is clear.',
			facts: [
				{ label: 'Mode', value: payload.mode },
				{ label: 'Scope', value: payload.scope },
				{ label: 'Branch', value: payload.branch ?? '(mixed)' },
				{ label: 'Repositories', value: payload.summary.repositories },
				{ label: 'Workflows', value: payload.summary.workflows },
				{ label: 'Passing', value: payload.summary.success },
				{ label: 'Failing', value: payload.summary.failure },
				{ label: 'Pending', value: payload.summary.pending },
				{ label: 'Missing', value: payload.summary.missing },
				{ label: 'Not pushed', value: payload.summary.notPushed },
				{ label: 'Errors', value: payload.summary.error },
				{ label: 'Checked at', value: payload.checkedAt },
			],
			sections: ciSections(payload, invocation.args.failed === true),
			report: result,
			exitCode: payload.exitCode,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
