import { normalizeWorkdayAgentSelection } from '@treeseed/sdk/agent-capacity';
import type { CommandContext,ParsedInvocation } from '../../../../types.js';
import { fail,guidedResult } from '../../../utilities/utils.js';
import { capacityBooleanArg,capacityCsvArg,capacityFlagArg,capacityPositiveNumberArg,capacityProviderSelector,capacityStringArg } from '../../capacity-core/capacity-command-arguments.js';
import { createCapacityMarketClient,resolveCapacityTeam } from '../../capacity-core/capacity-market-context.js';
import { capacityCollectionItems,isCapacityRecord } from '../../capacity-core/capacity-values.js';
import { resolveCapacityWorkdayProviderId } from '../configuration/capacity-workday-provider.js';
import { followWorkdayActivity } from '../observability/capacity-workday-follow.js';

export function compileCapacityWorkdayRequest(input: {
	id?: string | null;
	providerId: string;
	projects: string[];
	durationSeconds: number;
	maxActiveAssignments: number;
	planningRounds?: number;
	assignmentTimeboxSeconds?: number;
	planningOnly: boolean;
	purpose: string;
	allocationSetId?: string | null;
	agentClasses?: string[];
	agents?: string[];
	activityTypes?: string[];
	objectiveRefs?: string[];
	selectionMode?: string | null;
	executionMode?: 'simulation'|'production';
}) {
	return {
		...(input.id ? { id: input.id } : {}),
		capacityProviderId: input.providerId,
		scenarioId: input.purpose,
		status: 'running',
		environment: 'local',
		executionMode: input.executionMode ?? 'simulation',
		startedAt: new Date().toISOString(),
		parameters: {
			executionMode: input.executionMode ?? 'simulation',
			purpose: input.purpose,
			providerId: input.providerId,
			projects: input.projects,
			durationSeconds: input.durationSeconds,
			maxActiveAssignments: input.maxActiveAssignments,
			planningOnly: input.planningOnly,
			planningSession: {
				rounds: input.planningRounds ?? 3,
				assignmentTimeboxSeconds: input.assignmentTimeboxSeconds ?? 900,
			},
			...(input.allocationSetId ? { allocationSetId: input.allocationSetId } : {}),
			agentSelection: normalizeWorkdayAgentSelection({
				classIds: (input.agentClasses ?? []).filter((value) => value.includes(':')),
				classSlugs: (input.agentClasses ?? []).filter((value) => !value.includes(':')),
				agentSlugs: input.agents ?? [],
				activityTypes: input.activityTypes ?? [],
				mode: input.selectionMode ?? undefined,
			}),
			objectiveRefs: input.objectiveRefs ?? [],
		},
	};
}

export async function runCapacityWorkdayRun(invocation: ParsedInvocation, context: CommandContext) {
	const execute = capacityFlagArg(invocation, 'execute');
	if (execute && capacityFlagArg(invocation, 'plan')) return fail('Choose exactly one of --plan or --execute for capacity workday-run.');
	const teamSelector = capacityStringArg(invocation, 'team');
	const executionMode=capacityFlagArg(invocation,'production')?'production' as const:'simulation' as const;
	if(execute&&executionMode==='production'&&!capacityFlagArg(invocation,'yes')) return fail('Production workdays can create push-eligible reviewed results. Confirm with --production --yes.');
	if (!teamSelector) return fail('Missing --team. Use `trsd capacity workday-run --team <team-id-or-slug> --projects <slug,...> --plan`.');
	const { profile,client } = createCapacityMarketClient(invocation, context);
	const team = await resolveCapacityTeam(client, teamSelector);
	const inventoryResponse = team.projects.length ? { payload: team.projects } : await client.projects(team.teamId);
	const inventory = capacityCollectionItems(inventoryResponse.payload).filter(isCapacityRecord);
	const requested = capacityCsvArg(invocation, 'projects', inventory.map((project) => String(project.slug ?? project.id)));
	const bySlug = new Map(inventory.map((project) => [String(project.slug ?? project.id), project]));
	const missing = requested.filter((slug) => !bySlug.has(slug));
	if (missing.length) return fail(`Projects are not active in team ${teamSelector}: ${missing.join(', ')}.`);
	const projects = requested.map((slug) => bySlug.get(slug)!);
	if (!projects.length) return fail(`Team ${teamSelector} has no active projects to schedule.`);
	const provider = await resolveCapacityWorkdayProviderId(client, team.teamId, capacityProviderSelector(invocation));
	const request = compileCapacityWorkdayRequest({
		id: capacityStringArg(invocation, 'workday'),
		providerId: provider.providerId,
		projects: requested,
		durationSeconds: capacityPositiveNumberArg(invocation, 'durationSeconds', 900),
		maxActiveAssignments: capacityPositiveNumberArg(invocation, 'maxActiveAssignments', Math.max(1, requested.length)),
		planningRounds: capacityPositiveNumberArg(invocation, 'planningRounds', 3),
		assignmentTimeboxSeconds: capacityPositiveNumberArg(invocation, 'assignmentTimeboxSeconds', 900),
		planningOnly: !capacityBooleanArg(invocation, 'acting', false),
		purpose: capacityStringArg(invocation, 'purpose') ?? capacityStringArg(invocation, 'scenario') ?? 'team project planning',
		allocationSetId: capacityStringArg(invocation, 'allocation'),
		agentClasses: capacityCsvArg(invocation, 'agentClasses', []),
		agents: capacityCsvArg(invocation, 'agents', []),
		activityTypes: capacityCsvArg(invocation, 'activityProfiles', []),
		objectiveRefs: capacityCsvArg(invocation, 'objectiveRefs', []),
		selectionMode: capacityStringArg(invocation, 'selectionMode'),
		executionMode,
	});
	if (!execute) {
		const preflight = await client.preflightWorkdayRun(team.teamId, request);
		return guidedResult({
		command: 'capacity workday-run',
		summary: 'Workday plan passed the API-owned governance, graph, TreeDX, and time-budget preflight.',
		facts: [
			{ label: 'Control plane', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: team.teamId }, { label: 'Provider', value: provider.providerId },
			{ label: 'Projects', value: requested.length }, { label: 'Preflight', value: 'passed' },
		],
		report: { mode: 'plan', ok: true, request, preflight: preflight.payload },
		});
	}
	const response = await client.createWorkdayRun(team.teamId, request);
	const runId = String(response.payload.id ?? '');
	if (!runId) return fail('The control plane created a workday without returning its durable identifier.');
	let followed: { after: number; interrupted: boolean } | null = null;
	if (capacityFlagArg(invocation, 'follow')) followed = await followWorkdayActivity({
		client, teamId: team.teamId, workdayId: runId, context, jsonl: context.outputFormat === 'json',
		agents: capacityStringArg(invocation, 'agents'), agentClasses: capacityStringArg(invocation, 'agentClasses'), types: null, severity: null,
	});
	return guidedResult({
		command: 'capacity workday-run', summary: `Started API-owned workday ${runId}.`,
		facts: [
			{ label: 'Control plane', value: `${profile.id} (${profile.baseUrl})` }, { label: 'Team', value: team.teamId },
			{ label: 'Provider', value: provider.providerId }, { label: 'Projects', value: requested.length }, { label: 'Workday', value: runId },
		],
		nextSteps: followed ? [] : [`trsd capacity workday-log --market ${profile.id} --team ${team.teamId} --workday ${runId} --follow`],
		report: { mode: 'live', ok: true, runId, request, followed },
	});
}
