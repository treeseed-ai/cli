import { integrateAgentCheckpoint } from '@treeseed/sdk/operations';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { capacityFlagArg as flag, capacityStringArg as text } from './capacity-command-arguments.js';
import { capacityRecord as record } from './capacity-values.js';
import { fail, guidedResult } from '../../utilities/utils.js';

export const CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS = new Set(['checkpoint-integrate']);

export async function runCapacityCheckpointIntegration(
	invocation: ParsedInvocation,
	context: CommandContext,
) {
	const teamId = text(invocation, 'team');
	const assignmentId = text(invocation, 'assignment');
	if (!teamId) return fail('Missing --team for capacity checkpoint-integrate.');
	if (!assignmentId) return fail('Missing --assignment for capacity checkpoint-integrate.');
	const plan = flag(invocation, 'plan');
	const execute = flag(invocation, 'execute');
	if (plan === execute) return fail('Capacity checkpoint-integrate is mutating. Choose exactly one of --plan or --execute.');
	const { profile, client } = createMarketClientForInvocation(invocation, context, {
		requireAuth: true,
		allowLocalAcceptanceAdmin: true,
	});
	const assignment = (await client.capacityProviderAssignment(teamId, assignmentId)).payload;
	const decisionInput = record(assignment.decisionInput);
	const selectedInput = record(decisionInput.input);
	const metadata = record(decisionInput.metadata);
	const graphId = String(selectedInput.workGraphId ?? metadata.graphId ?? '').trim();
	if (!graphId) return fail('Assignment does not identify a durable decision assignment graph.');
	const graph = (await client.decisionAssignmentGraph(graphId)).payload;
	const projectId = String(assignment.projectId ?? '').trim();
	if (!projectId) return fail('Assignment does not identify a durable project.');
	const topology = (await client.projectRepositoryTopology(projectId)).payload;
	const projectRepository = Object.keys(record(topology.projectRepository)).length
		? record(topology.projectRepository)
		: record(topology.siteRepository);
	const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.map(record) : [];
	const graphNodeId = String(selectedInput.workGraphNodeId ?? metadata.graphNodeId ?? '').trim();
	const selectedNode = graphNodes.find((node) => String(node.id ?? '') === graphNodeId);
	const contractId = String(record(selectedNode?.metadata).producesDeliverableContractId ?? '').trim();
	if (!contractId) return fail('Assignment graph node does not identify its deliverable contract.');
	const deliverableManifest = (await client.deliverableManifest(`deliverable:${assignmentId}`)).payload;
	const result = await integrateAgentCheckpoint({
		workspaceRoot: context.cwd,
		assignment,
		graph,
		projectRepository,
		deliverableManifest,
		mode: execute ? 'execute' : 'plan',
	});
	const ok = result.ok;
	return guidedResult({
		command: 'capacity checkpoint-integrate',
		summary: ok
			? execute ? 'Integrated the reviewed assignment checkpoint into the current task branch.' : 'Assignment checkpoint integration plan is admissible.'
			: 'Assignment checkpoint integration is blocked.',
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Assignment', value: assignmentId },
			{ label: 'Graph', value: graphId },
			{ label: 'Repository', value: result.repositoryPath },
			{ label: 'Task branch', value: result.targetBranch },
			{ label: 'Checkpoint', value: result.checkpointCommit },
			{ label: 'Integrated commit', value: result.integratedCommit },
		],
		sections: [
			{ title: 'Changed paths', lines: result.changedPaths.map((path) => `- ${path}`) },
			{ title: 'Blockers', lines: result.blockers.map((blocker) => `- ${blocker}`) },
		],
		nextSteps: ok && execute
			? [`Run npx trsd save "Integrate supervised agent assignment ${assignmentId}" --json from this managed task worktree.`]
			: ok ? [`Re-run with --execute after reviewing assignment ${assignmentId}, its checkpoint, and the changed paths above.`] : [],
		report: { mode: execute ? 'execute' : 'plan', result },
		exitCode: ok ? 0 : 1,
		stderr: ok ? undefined : result.blockers,
	});
}
