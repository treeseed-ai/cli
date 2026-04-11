import { TreeseedWorkflowError, TreeseedWorkflowSdk, type TreeseedWorkflowContext, type TreeseedWorkflowNextStep, type TreeseedWorkflowResult } from '@treeseed/sdk/workflow';
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
		return {
			exitCode: error.exitCode ?? (error.code === 'merge_conflict' ? 12 : 1),
			stderr: [error.message],
			report: {
				ok: false,
				error: error.message,
				code: error.code,
				operation: error.operation,
				details: error.details ?? null,
			},
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return {
		exitCode: 1,
		stderr: [message],
		report: {
			ok: false,
			error: message,
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
