import { randomUUID } from 'node:crypto';
import type { CommandContext, ParsedInvocation } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { capacityCsvArg, capacityPositiveNumberArg, capacityStringArg as text } from '../capacity-core/capacity-command-arguments.js';
import { resolveCapacityTeam } from '../capacity-core/capacity-market-context.js';

export const CAPACITY_AGENT_SIMULATION_ACTIONS = new Set(['agent-simulation-run']);

export async function runCapacityAgentSimulation(
	action: string,
	invocation: ParsedInvocation,
	context: CommandContext,
) {
	const teamSelector = text(invocation, 'team');
	const projectId = text(invocation, 'project');
	if (!teamSelector || !projectId) return fail(`Capacity ${action} requires --team and --project.`);
	const plan = invocation.args.plan === true;
	const execute = invocation.args.execute === true;
	if (plan === execute) return fail(`Capacity ${action} is mutating. Choose exactly one of --plan or --execute.`);
	const { profile, client } = createMarketClientForInvocation(invocation, context, {
		requireAuth: true,
		allowLocalAcceptanceAdmin: true,
	});
	const { teamId } = await resolveCapacityTeam(client, teamSelector);
	const draft = (await client.projectAgentAuthoringDraft(teamId, projectId, {
		durationSeconds: capacityPositiveNumberArg(invocation, 'durationSeconds', 900),
		planningRounds: capacityPositiveNumberArg(invocation, 'planningRounds', 3),
		assignmentTimeboxSeconds: capacityPositiveNumberArg(invocation, 'assignmentTimeboxSeconds', 600),
		maxActiveAssignments: capacityPositiveNumberArg(invocation, 'maxActiveAssignments', 4),
		agentSlugs: capacityCsvArg(invocation, 'agents', []),
		activityTypes: capacityCsvArg(invocation, 'activityProfiles', []),
	})).payload;
	const errors = draft.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
	if (errors.length) return fail(errors.map((diagnostic) => `${diagnostic.path ?? 'definition'}: ${diagnostic.message}`).join(' | '));
	const files = [
		{ path: draft.seedPath, source: draft.seedYaml },
		{ path: draft.scenePath, source: draft.sceneYaml },
		...(draft.testPath && draft.testMdx ? [{ path: draft.testPath, source: draft.testMdx }] : []),
	];
	if (plan) return guidedResult({
		command: `capacity ${action}`,
		summary: `Planned the repository-authored Agent Lab simulation for ${draft.projectName}.`,
		report: { action, mode: 'plan', teamId, projectId, expectedBase: draft.expectedBase, files: files.map((file) => file.path), diagnostics: draft.diagnostics },
	});
	const publication = (await client.authorProjectDefinitions(teamId, {
		projectId,
		files,
		expectedBase: draft.expectedBase,
		changeSummary: 'Agent Lab simulation definition',
		executionMode: 'simulation',
	})).payload;
	const requestId = text(invocation, 'idempotencyKey') ?? `cli:agent-simulation:${randomUUID()}`;
	const simulation = (await client.launchProjectAgentSimulation(teamId, {
		projectId,
		scenePath: draft.scenePath,
		immutableRef: publication.commit,
		requestId,
	})).payload;
	return guidedResult({
		command: `capacity ${action}`,
		summary: `Committed and queued the repository-authored Agent Lab simulation for ${draft.projectName}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Commit', value: publication.commit },
			{ label: 'Operation', value: simulation.id },
		],
		report: { action, mode: 'live', teamId, projectId, requestId, publication, simulation },
	});
}
