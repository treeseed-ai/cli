import { TreeseedWorkflowError, TreeseedWorkflowSdk, type TreeseedWorkflowContext, type TreeseedWorkflowNextStep, type TreeseedWorkflowResult } from '@treeseed/sdk/workflow';
import { TreeseedKeyAgentError } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandContext, TreeseedCommandResult } from '../types.js';

export function createWorkflowSdk(context: TreeseedCommandContext, overrides: Partial<TreeseedWorkflowContext> = {}) {
	return new TreeseedWorkflowSdk({
		cwd: context.cwd,
		env: context.env,
		write: context.write,
		transport: 'cli',
		...overrides,
	});
}

export function workflowErrorResult(error: unknown): TreeseedCommandResult {
	if (error instanceof TreeseedWorkflowError) {
		const recovery = (error.details?.recovery ?? null) as Record<string, unknown> | null;
		return {
			exitCode: error.exitCode ?? (error.code === 'merge_conflict' ? 12 : 1),
			stderr: [error.message],
			report: {
				schemaVersion: 1,
				kind: 'treeseed.workflow.result',
				command: error.operation,
				executionMode: 'execute',
				runId: typeof recovery?.runId === 'string' ? recovery.runId : null,
				ok: false,
				operation: error.operation,
				summary: error.message,
				facts: [],
				error: error.message,
				code: error.code,
				payload: null,
				result: null,
				nextSteps: [],
				recovery,
				errors: [
					{
						code: error.code,
						message: error.message,
						details: error.details ?? null,
					},
				],
			},
		};
	}
	if (error instanceof TreeseedKeyAgentError) {
		return {
			exitCode: 1,
			stderr: [error.message],
			report: {
				schemaVersion: 1,
				kind: 'treeseed.workflow.result',
				command: 'status',
				executionMode: 'execute',
				runId: null,
				ok: false,
				operation: 'status',
				summary: error.message,
				facts: [],
				error: error.message,
				code: error.code,
				payload: null,
				result: null,
				nextSteps: [],
				recovery: null,
				errors: [
					{
						code: error.code,
						message: error.message,
						details: error.details ?? null,
					},
				],
			},
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return {
		exitCode: 1,
		stderr: [message],
		report: {
			schemaVersion: 1,
			kind: 'treeseed.workflow.result',
			command: 'status',
			executionMode: 'execute',
			runId: null,
			ok: false,
			operation: 'status',
			summary: message,
			facts: [],
			error: message,
			payload: null,
			result: null,
			nextSteps: [],
			recovery: null,
			errors: [
				{
					code: 'unsupported_state',
					message,
				},
			],
		},
	};
}

export function renderWorkflowNextStep(step: TreeseedWorkflowNextStep) {
	const input = step.input ?? {};
	switch (step.operation) {
		case 'switch':
			return `treeseed switch ${String(input.branch ?? 'feature/my-change')}${input.preview ? ' --preview' : ''}`;
		case 'save':
			return `treeseed save "${String(input.message ?? 'describe your change')}"${input.hotfix ? ' --hotfix' : ''}`;
		case 'close':
			return `treeseed close "${String(input.message ?? 'reason')}"`;
		case 'stage':
			return `treeseed stage "${String(input.message ?? 'describe the resolution')}"`;
		case 'release':
			return `treeseed release --${String(input.bump ?? 'patch')}`;
		case 'resume':
			return `treeseed resume ${String(input.runId ?? '<run-id>')}`;
		case 'recover':
			return 'treeseed recover';
		case 'config': {
			const environments = Array.isArray(input.environment) ? input.environment : Array.isArray(input.target) ? input.target : null;
			return environments?.length ? `treeseed config --environment ${environments[0]}` : 'treeseed config';
		}
		case 'init':
			return `treeseed init ${String(input.directory ?? '<directory>')}`;
		case 'rollback':
			return `treeseed rollback ${String(input.environment ?? 'prod')}`;
		default:
			return `treeseed ${step.operation}`;
	}
}

export function renderWorkflowNextSteps(result: TreeseedWorkflowResult) {
	return (result.nextSteps ?? []).map((step) => {
		const command = renderWorkflowNextStep(step);
		return step.reason ? `${command}  # ${step.reason}` : command;
	});
}
