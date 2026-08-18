import { WorkflowError, WorkflowSdk, type WorkflowContext, type WorkflowNextStep, type WorkflowResult } from '@treeseed/sdk/workflow';
import { KeyAgentError } from '@treeseed/sdk/workflow-support';
import { compileHostingGraph, serializeHostingUnit, type HostingEnvironment } from '@treeseed/sdk/hosting';
import type { CommandContext, CommandResult } from '../../types.js';

export function createWorkflowSdk(context: CommandContext, overrides: Partial<WorkflowContext> = {}) {
	return new WorkflowSdk({
		cwd: context.cwd,
		env: context.env,
		write: context.write,
		transport: 'cli',
		...overrides,
	});
}

export function workflowErrorResult(error: unknown): CommandResult {
	if (error instanceof WorkflowError) {
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
	if (error instanceof KeyAgentError) {
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

export function renderWorkflowNextStep(step: WorkflowNextStep) {
	const input = step.input ?? {};
	switch (step.operation) {
		case 'switch':
			return `treeseed switch ${String(input.branch ?? 'feature/my-change')}${input.preview ? ' --preview' : ''}`;
		case 'save': {
			const message = String(input.message ?? '').trim();
			return `treeseed save${message ? ` "${message}"` : ''}${input.hotfix ? ' --hotfix' : ''}`;
		}
		case 'update':
			return `treeseed update --from ${String(input.from ?? 'staging')}`;
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

export function renderWorkflowNextSteps(result: WorkflowResult) {
	return (result.nextSteps ?? []).map((step) => {
		const command = renderWorkflowNextStep(step);
		return step.reason ? `${command}  # ${step.reason}` : command;
	});
}

export function resolveWorkflowHostingGraph(context: CommandContext, environment: HostingEnvironment, applicationSelection?: { selected?: string[] }) {
	try {
		const selectedApps = Array.isArray(applicationSelection?.selected) ? applicationSelection.selected.filter((app) => typeof app === 'string') : [];
		const graph = compileHostingGraph({
			tenantRoot: context.cwd,
			environment,
			appId: selectedApps.length === 1 ? selectedApps[0] : undefined,
		});
		return {
			environment: graph.environment,
			selectedApplications: selectedApps,
			placements: graph.placements,
			units: graph.units.map((unit) => serializeHostingUnit(unit)),
			warnings: graph.warnings,
		};
	} catch (error) {
		return {
			environment,
			selectedApplications: [],
			error: error instanceof Error ? error.message : String(error),
			placements: [],
			units: [],
			warnings: [],
		};
	}
}

export function hostingGraphSections(hostingGraph: ReturnType<typeof resolveWorkflowHostingGraph>) {
	if (hostingGraph.error) {
		return [{
			title: 'Hosting graph',
			lines: [hostingGraph.error],
		}];
	}
	return [{
		title: 'Hosting graph',
		lines: hostingGraph.placements.length > 0
			? hostingGraph.placements.map((placement) =>
				`${placement.label}: ${placement.serviceIds.join(', ')} on ${placement.hostIds.join(', ')}`)
			: ['No hosting placements resolved.'],
	}];
}
