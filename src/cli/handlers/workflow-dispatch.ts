import {
	planTreeseedReconciliation,
	reconcileTreeseedTarget,
	type TreeseedDesiredUnit,
} from '@treeseed/sdk/reconcile';
import { resolveTreeseedLaunchEnvironment } from '@treeseed/sdk/workflow-support';
import { execFileSync } from 'node:child_process';
import type { TreeseedCommandHandler, TreeseedParsedInvocation } from '../types.js';
import { fail, guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

function stringArg(invocation: TreeseedParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boolArg(invocation: TreeseedParsedInvocation, key: string) {
	return invocation.args[key] === true;
}

function inputArgs(value: unknown) {
	const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
	const inputs: Record<string, string> = {};
	for (const entry of entries) {
		const separator = entry.indexOf('=');
		if (separator <= 0) {
			throw new Error(`Invalid workflow input "${entry}". Use --input key=value.`);
		}
		const key = entry.slice(0, separator).trim();
		const inputValue = entry.slice(separator + 1);
		if (!key) {
			throw new Error(`Invalid workflow input "${entry}". Use --input key=value.`);
		}
		inputs[key] = inputValue;
	}
	return inputs;
}

function jsonResult(invocation: TreeseedParsedInvocation, context: unknown, report: Record<string, unknown>, exitCode: number) {
	if ((context as { outputFormat?: string }).outputFormat === 'json' || boolArg(invocation, 'json')) {
		return { exitCode, stdout: [JSON.stringify(report, null, 2)], stderr: [], report };
	}
	return null;
}

function workflowDispatchUnit(input: {
	repository: string;
	workflow: string;
	branch: string;
	inputs: Record<string, string>;
	wait: boolean;
	timeoutMs: number | null;
	expectedHeadSha?: string | null;
}) {
	const unit: TreeseedDesiredUnit = {
		unitId: `github-workflow-dispatch:${input.repository}:${input.branch}:${input.workflow}`.replace(/[^A-Za-z0-9:._/-]+/gu, '-'),
		unitType: 'github-workflow-dispatch',
		provider: 'github',
		identity: {
			project: 'treeseed',
			environment: 'staging',
			resource: 'github-workflow-dispatch',
			name: `${input.repository}:${input.workflow}`,
		},
		target: { kind: 'persistent', scope: 'staging' },
		logicalName: `${input.repository} ${input.workflow} @ ${input.branch}`,
		dependencies: [],
		spec: {
			repository: input.repository,
			workflow: input.workflow,
			branch: input.branch,
			inputs: input.inputs,
			wait: input.wait,
			...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
			...(input.expectedHeadSha ? { expectedHeadSha: input.expectedHeadSha } : {}),
		},
		secrets: {},
		metadata: {
			resourceKind: 'github-workflow-dispatch',
			repository: input.repository,
			workflow: input.workflow,
			branch: input.branch,
		},
	};
	return unit;
}

function normalizeRepositoryUrl(value: string) {
	const trimmed = value.trim().replace(/\.git$/u, '');
	const sshMatch = /^git@github\.com:(?<repo>[^/]+\/[^/]+)$/u.exec(trimmed);
	if (sshMatch?.groups?.repo) return sshMatch.groups.repo.toLowerCase();
	const urlMatch = /^https:\/\/github\.com\/(?<repo>[^/]+\/[^/]+)$/u.exec(trimmed);
	if (urlMatch?.groups?.repo) return urlMatch.groups.repo.toLowerCase();
	return trimmed.toLowerCase();
}

function resolveExpectedHeadSha(cwd: string, repository: string, branch: string) {
	try {
		const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		if (normalizeRepositoryUrl(remoteUrl) !== repository.toLowerCase()) return null;
		const output = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 30_000,
		}).trim();
		const [sha] = output.split(/\s+/u);
		return /^[0-9a-f]{40}$/iu.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

export const handleWorkflow: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const action = invocation.positionals[0] ?? 'dispatch';
		if (action !== 'dispatch') {
			return fail(`Unsupported workflow action "${action}". Use dispatch.`);
		}
		const repository = stringArg(invocation, 'repo') ?? stringArg(invocation, 'repository');
		const workflow = stringArg(invocation, 'workflow');
		const branch = stringArg(invocation, 'branch') ?? stringArg(invocation, 'ref') ?? 'staging';
		if (!repository) return fail('Missing --repo owner/name.');
		if (!workflow) return fail('Missing --workflow <file>.');
		const execute = boolArg(invocation, 'execute');
		const wait = invocation.args.wait === undefined ? execute : boolArg(invocation, 'wait');
		const timeoutRaw = stringArg(invocation, 'timeout');
		const timeoutMs = timeoutRaw ? Number(timeoutRaw) * 1000 : null;
		if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
			throw new Error(`Invalid --timeout "${timeoutRaw}". Use a positive number of seconds.`);
		}
		const inputs = inputArgs(invocation.args.input);
		const env = resolveTreeseedLaunchEnvironment({
			tenantRoot: context.cwd,
			scope: 'staging',
			baseEnv: context.env,
		});
		const target = { kind: 'persistent' as const, scope: 'staging' as const };
		const expectedHeadSha = resolveExpectedHeadSha(context.cwd, repository, branch);
		const units = [workflowDispatchUnit({ repository, workflow, branch, inputs, wait, timeoutMs, expectedHeadSha })];
		const result = execute
			? await reconcileTreeseedTarget({
				tenantRoot: context.cwd,
				target,
				env,
				units,
				dryRun: false,
				write: (line) => context.write(`[workflow] ${line}`, 'stderr'),
			})
			: await planTreeseedReconciliation({
				tenantRoot: context.cwd,
				target,
				env,
				units,
				write: (line) => context.write(`[workflow] ${line}`, 'stderr'),
			});
		const ok = execute ? result.ok : !result.plans.some((plan) => plan.diff.action === 'blocked');
		const report = {
			ok,
			action: execute ? 'dispatch' : 'plan',
			repository,
			workflow,
			branch,
			inputs,
			wait,
			reconcile: result,
		};
		const json = jsonResult(invocation, context, report, ok ? 0 : 1);
		if (json) return json;
		return guidedResult({
			command: 'workflow dispatch',
			summary: execute ? 'Workflow dispatch completed.' : 'Workflow dispatch plan ready.',
			facts: [
				{ label: 'Repository', value: repository },
				{ label: 'Workflow', value: workflow },
				{ label: 'Branch', value: branch },
				{ label: 'Mode', value: execute ? 'execute' : 'plan' },
			],
			report,
			exitCode: ok ? 0 : 1,
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
