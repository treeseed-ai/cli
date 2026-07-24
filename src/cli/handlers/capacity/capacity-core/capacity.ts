import { randomUUID } from 'node:crypto';
import type { CommandContext, CommandHandler, ParsedInvocation } from '../../../types.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { CAPACITY_GOVERNANCE_ACTIONS, runCapacityGovernanceAction } from './capacity-governance.js';
import { CAPACITY_PROVIDER_GOVERNANCE_ACTIONS, runCapacityProviderGovernanceAction } from '../providers/capacity-provider-governance.js';
import { CAPACITY_WORKDAY_ACTIONS, runCapacityWorkdayAction } from '../workdays/lifecycle/capacity-workday.js';
import { CAPACITY_ASSIGNMENT_ACTIONS, runCapacityAssignmentAction } from '../assignments/capacity-assignments.js';
import { CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS, runCapacityCheckpointIntegration } from './capacity-checkpoint-integration.js';
import { CAPACITY_OVERRUN_ACTIONS, runCapacityOverrunAction } from '../accounting/capacity-overruns.js';
import { CAPACITY_EVIDENCE_ACTIONS, runCapacityEvidenceAction } from '../observability/capacity-evidence.js';
import { CAPACITY_AGENT_CLASS_ACTIONS, runCapacityAgentClassAction } from '../agents/capacity-agent-classes.js';
import { resolveCapacityWorkdayProviderId } from '../workdays/configuration/capacity-workday-provider.js';
import { capacityBooleanArg as booleanArg, capacityCsvArg as csvArg, capacityFlagArg as boolArg, capacityPositiveNumberArg as positiveNumberArg, capacityProviderSelector as providerSelector, capacityStringArg as stringArg } from './capacity-command-arguments.js';
import { PROVIDER_ENTRYPOINT_ACTIONS, PROVIDER_LIFECYCLE_ACTIONS, runCapacityLifecycleAction, runCapacityProviderEntrypoint } from './capacity-runtime.js';
import { capacityCollectionItems as collectionItems, capacityRecordValue as recordValue, isCapacityRecord as isRecord } from './capacity-values.js';
import { createCapacityMarketClient as createCapacityWorkdayMarketClient, resolveCapacityTeam as resolveCapacityWorkdayTeam } from './capacity-market-context.js';
import { CAPACITY_MARKET_INSPECTION_ACTIONS, runCapacityMarketInspection } from './capacity-market-inspection.js';
import { runCapacityDiagnostics } from '../observability/capacity-diagnostics.js';
import { runExecutionRunsInspection } from '../workdays/observability/capacity-workday-inspection.js';
import { capacityWorkdayScore, holdWorkdayOpen, writeWorkdayRunReportFiles } from '../workdays/observability/capacity-workday-report.js';
import { collectCapacityWorkdayResults } from '../workdays/observability/capacity-workday-results.js';
import {
	ensureCapacityWorkdayAgentClasses,
	ensureLocalTreeDxForCapacityWorkday,
	objectArg,
	optionalString,
	readCapacityWorkdayAgentSpecs,
	type CapacityWorkdayAgentSpec,
} from '../workdays/configuration/capacity-workday-projects.js';
import { waitForCapacityWorkdayAssignments } from '../workdays/execution/capacity-workday-assignment-poller.js';

export { PROVIDER_ENTRYPOINT_ACTIONS, PROVIDER_LIFECYCLE_ACTIONS } from './capacity-runtime.js';
export const MARKET_INSPECTION_ACTIONS = new Set([...CAPACITY_MARKET_INSPECTION_ACTIONS, 'execution-runs', 'workday-log', 'workday-run']);
const WORKDAY_TEST_PROJECT_SLUGS = ['market', 'admin', 'agent', 'api', 'cli', 'core', 'sdk', 'ui', 'treedx'];

function safeWorkdayIdPart(value: string) {
	return value.replace(/[^a-zA-Z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 96) || randomUUID();
}

async function runWorkdayRun(invocation: ParsedInvocation, context: CommandContext) {
	const { profile, client, authMode } = createCapacityWorkdayMarketClient(invocation, context);
	const teamSelector = stringArg(invocation, 'team');
	if (!teamSelector) return fail('Missing --team. Use `trsd capacity workday-run --team <team-id> --provider local --execute --json`.');
	const teamResolution = await resolveCapacityWorkdayTeam(client, teamSelector);
	const teamId = teamResolution.teamId;
	const providerSelectorValue = providerSelector(invocation);
	const projectSlugs = csvArg(invocation, 'projects', WORKDAY_TEST_PROJECT_SLUGS);
	const providerResolution = await resolveCapacityWorkdayProviderId(client, teamId, providerSelectorValue);
	const providerId = providerResolution.providerId;
	const execute = boolArg(invocation, 'execute');
	const durationSeconds = positiveNumberArg(invocation, 'durationSeconds', execute ? 900 : 0);
	const settleSeconds = positiveNumberArg(invocation, 'waitSeconds', execute ? 30 : 0);
	const actingEnabled = booleanArg(invocation, 'acting', false);
	const abortOnDegradation = boolArg(invocation, 'abort');
	const parameters = {
		purpose: stringArg(invocation, 'purpose') ?? stringArg(invocation, 'scenario') ?? 'portfolio planning',
		seed: stringArg(invocation, 'seed') ?? 'treeseed',
		providerId,
		providerSelector: providerSelectorValue,
		projects: projectSlugs,
		workdays: positiveNumberArg(invocation, 'workdays', 1),
		durationSeconds,
		waitSeconds: settleSeconds,
		maxActiveAssignments: positiveNumberArg(invocation, 'maxActiveAssignments', Math.max(1, projectSlugs.length)),
		availableCredits: positiveNumberArg(invocation, 'availableCredits', 100),
		allocationSetId: stringArg(invocation, 'allocation'),
		planningOnly: boolArg(invocation, 'planningOnly') || !actingEnabled,
		abortOnDegradation,
		mode: execute ? 'live' : 'plan',
		reportDir: stringArg(invocation, 'reportDir') ?? '.treeseed/workday-reports',
	};
	const projectsResponse = teamResolution.projects.length > 0
		? { payload: teamResolution.projects }
		: await client.projects(teamId);
	const projects = (projectsResponse.payload as Array<Record<string, unknown>>)
		.filter((project) => projectSlugs.includes(String(project.slug ?? project.id)));
	const unexpectedSeedProjects = (projectsResponse.payload as Array<Record<string, unknown>>)
		.filter((project) => String(project.slug ?? project.id) === 'karyon');
	const localTreeDxRepositoryIds = new Map<string, string>();
	const localTreeDxContentPaths = new Map<string, string>();
	let localTreeDxSetup: Record<string, unknown> | null = null;
	if (parameters.mode === 'live' && profile.id === 'local') {
		try {
			await Promise.all(projects.map(async (project) => {
				const slug = String(project.slug ?? project.id);
				const library = await client.projectTreeDxLibrary(String(project.id)).catch(() => null);
				const libraryPayload = recordValue(library, 'payload');
				const repositoryId = String(recordValue(libraryPayload, 'repositoryId') ?? '').trim();
				const configuredContentPath = String(recordValue(libraryPayload, 'contentPath') ?? '').trim();
				if (configuredContentPath) localTreeDxContentPaths.set(slug, configuredContentPath);
				if (repositoryId) localTreeDxRepositoryIds.set(slug, repositoryId);
			}));
			if (localTreeDxRepositoryIds.size < projects.length) {
				const missingSlugs = projects
					.map((project) => String(project.slug ?? project.id))
					.filter((slug) => !localTreeDxRepositoryIds.has(slug));
				const localTreeDx = await ensureLocalTreeDxForCapacityWorkday(context, missingSlugs);
				for (const [slug, repositoryId] of Object.entries(localTreeDx.repositoryIdsBySlug)) {
					localTreeDxRepositoryIds.set(slug, repositoryId);
				}
				localTreeDxSetup = {
					mode: 'reconciled_missing_bindings',
					missingSlugs,
					...localTreeDx,
				};
			} else {
				localTreeDxSetup = {
					mode: 'reused_existing_project_libraries',
					projectSlugs,
					repositoryIdsBySlug: Object.fromEntries(localTreeDxRepositoryIds),
				};
			}
			await client.updateTeamTreeDx(teamId, {
				id: 'local-primary',
				kind: 'self_hosted',
				provider: 'local',
				name: 'Local TreeDX',
				baseUrl: 'http://127.0.0.1:4000',
				registryUrl: 'http://127.0.0.1:4000',
				status: 'active',
				primary: true,
				metadata: {
					source: 'capacity_workday_runtime',
					environment: 'local',
				},
			}).catch((error) => {
				throw new Error(`Local TreeDX team binding failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			await Promise.all(projects.map(async (project) => {
				const projectId = String(project.id);
				const slug = String(project.slug ?? project.id);
				const repositoryId = localTreeDxRepositoryIds.get(slug);
				if (!repositoryId) throw new Error(`Local TreeDX reconciliation did not return a repository id for ${slug}.`);
				const metadata = objectArg(project.metadata);
				const architecture = objectArg(metadata.architecture);
				const contentPath = localTreeDxContentPaths.get(slug)
					?? optionalString(architecture.contentPath)
					?? (slug === 'market' ? 'src/content' : 'docs/src/content');
				const binding = await client.upsertProjectTreeDxLibrary(projectId, {
					repositoryId,
					contentPath,
					contentRepositoryRef: 'refs/heads/main',
					metadata: { source: 'local_treedx_reconciliation', environment: 'local' },
				});
				const persistedRepositoryId = String(recordValue(recordValue(binding, 'payload'), 'repositoryId') ?? '').trim();
				if (persistedRepositoryId !== repositoryId) {
					throw new Error(`Local TreeDX project binding verification failed for ${slug}.`);
				}
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return fail(`Local TreeDX readiness failed: ${message}`);
		}
	}
	const projectStates: Array<{
		projectId: string;
		slug: string;
		workdayId: string | null;
		agentClasses: Array<Record<string, unknown>>;
		contentAgents: CapacityWorkdayAgentSpec[];
		contentAgentCount: number;
		assignmentIds: string[];
		assignmentCount: number;
		blockers: string[];
	}> = [];
	const agentClassSyncKey = stringArg(invocation, 'idempotencyKey') ?? `workday-agent-class-sync:${randomUUID()}`;
	for (const project of projects) {
		const projectId = String(project.id);
		const slug = String(project.slug ?? project.id);
		const agentClassesResponse = await client.projectAgentClasses(projectId).catch(() => ({ payload: { items: [] as unknown[] } }));
		const agentClasses = collectionItems(agentClassesResponse.payload).filter(isRecord);
		const plannedContentAgents = parameters.mode === 'plan' ? await readCapacityWorkdayAgentSpecs(context, slug) : null;
		const preparedAgents = parameters.mode === 'plan'
			? {
				agentClasses,
				contentAgents: plannedContentAgents ?? [],
				contentAgentCount: plannedContentAgents?.length ?? 0,
			}
			: await ensureCapacityWorkdayAgentClasses(client, context, projectId, slug, agentClasses, agentClassSyncKey);
		projectStates.push({
			projectId,
			slug,
			workdayId: safeWorkdayIdPart(`workday-pending-${slug}`),
			agentClasses: preparedAgents.agentClasses,
			contentAgents: preparedAgents.contentAgents,
			contentAgentCount: preparedAgents.contentAgentCount,
			assignmentIds: [],
			assignmentCount: 0,
			blockers: preparedAgents.contentAgentCount === 0 ? ['no enabled planning activity profiles were found'] : [],
		});
	}
	const repositoryIdsBySlug = Object.fromEntries(localTreeDxRepositoryIds);
	if (parameters.mode === 'plan') {
		return guidedResult({
			command: 'capacity workday-run',
			summary: 'Capacity workday plan rendered without synchronizing classes, reconciling TreeDX, or creating control-plane records.',
			facts: [
				{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
				{ label: 'Team', value: teamId },
				{ label: 'Provider', value: providerId },
				{ label: 'Projects', value: projectStates.length },
			],
			report: {
				ok: projectStates.every((state) => state.contentAgentCount > 0),
				mode: 'plan',
				parameters,
				projects: projectStates.map((state) => ({
					projectId: state.projectId,
					slug: state.slug,
					configuredAgentCount: state.contentAgentCount,
					agents: state.contentAgents.map((agent) => ({ slug: agent.slug, activityType: agent.activityType, handler: agent.handler })),
					blockers: state.blockers,
				})),
			},
		});
	}
	const runResponse = await client.createWorkdayRun(teamId, {
		capacityProviderId: providerId,
		scenarioId: parameters.purpose,
		status: 'running',
		environment: 'local',
		startedAt: new Date().toISOString(),
		parameters: { ...parameters, repositoryIdsBySlug },
		expected: {
			projects: projectSlugs,
			agentCountsByProject: Object.fromEntries(projectStates.map((state) => [state.slug, state.contentAgentCount])),
			planningModeRequired: true,
			actingModeRequired: !parameters.planningOnly,
		},
	});
	const run = runResponse.payload as Record<string, unknown>;
	const runId = String(run.id);
	let eventCount = 0;
	const event = async (body: Record<string, unknown>) => {
		eventCount += 1;
		await client.createWorkdayEvent(teamId, runId, body).catch(() => null);
	};
	await event({
		eventType: 'command.started',
		status: 'recorded',
		title: 'Live workday command started',
		parameters,
		context: {
			cwd: context.cwd,
			market: profile.id,
			teamSelector,
			teamId,
			authMode,
			...(authMode === 'local_acceptance_admin' ? { auth: { mode: authMode, bearerToken: '[redacted]' } } : {}),
		},
	});
	if (localTreeDxSetup) {
		await event({
			eventType: 'treedx.local_ready',
			status: 'recorded',
			title: 'Local TreeDX repositories ready for API-owned workday',
			context: localTreeDxSetup,
		});
	}
	if (unexpectedSeedProjects.length > 0) {
		await event({
			eventType: 'seed.boundary.warning',
			status: 'warning',
			title: 'Unexpected Karyon project found in Treeseed team local state',
			context: { projectIds: unexpectedSeedProjects.map((project) => project.id) },
		});
	}
	const providerSessions = await client.providerAvailabilitySessions(teamId, { providerId }).catch(() => ({ payload: { items: [] as unknown[] } }));
	const providerReady = collectionItems(providerSessions.payload).filter(isRecord).some((session) => ['open', 'active', 'available'].includes(String(session.status ?? session.state ?? '').toLowerCase()));
	const completedDurationWorkdayIds = new Set<string>();
	let durationWindow: { startedAt: string; deadlineAt: string; completedAt: string } | null = null;
	for (const projectState of projectStates) {
		projectState.workdayId = safeWorkdayIdPart(`workday-${runId}-${projectState.slug}`);
	}
	if (parameters.mode === 'live' && parameters.durationSeconds > 0) {
		durationWindow = await holdWorkdayOpen({
			runId,
			durationSeconds: parameters.durationSeconds,
			event,
		});
	}
	let waitedAssignmentSnapshots: Map<string, Record<string, unknown>[]> | null = null;
	let waitTimedOutAssignmentIds = new Set<string>();
	if (parameters.mode === 'live' && parameters.waitSeconds > 0) {
		await event({
			eventType: 'provider.wait.started',
			status: 'recorded',
			title: `Waiting up to ${parameters.waitSeconds}s for provider manager and runner lease consumption`,
			context: { waitSeconds: parameters.waitSeconds },
		});
		const waitResult = await waitForCapacityWorkdayAssignments(client, teamId, projectStates, providerId, parameters.waitSeconds, runId);
		waitedAssignmentSnapshots = waitResult.snapshots;
		waitTimedOutAssignmentIds = new Set(waitResult.unfinished.map((assignment) => String(assignment.id ?? '')).filter(Boolean));
		await event({
			eventType: 'provider.wait.completed',
			status: waitResult.completed ? 'recorded' : 'warning',
			title: waitResult.completed ? 'Provider lease-consumption wait completed' : 'Provider lease-consumption wait timed out before all assignments reached terminal state',
			context: {
				waitSeconds: parameters.waitSeconds,
				completed: waitResult.completed,
				unfinishedAssignments: waitResult.unfinished.map((assignment) => ({
					id: assignment.id ?? null,
					projectId: assignment.projectId ?? null,
					status: assignment.status ?? null,
					leaseState: assignment.leaseState ?? null,
				})),
			},
		});
	}
	if (parameters.mode === 'live' && durationWindow) {
		for (const projectState of projectStates) {
			if (!projectState.workdayId || completedDurationWorkdayIds.has(projectState.workdayId)) continue;
			await client.completeWorkday(projectState.workdayId, `workday-close:${runId}:${projectState.workdayId}:duration`).catch((error) => {
				projectState.blockers.push(`timed workday close failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			completedDurationWorkdayIds.add(projectState.workdayId);
			await event({
				eventType: 'workday.duration.closed',
				status: 'recorded',
				projectId: projectState.projectId,
				workdayId: projectState.workdayId,
				title: `Closed timed workday for ${projectState.slug}`,
				context: {
					durationSeconds: parameters.durationSeconds,
					deadlineAt: durationWindow.deadlineAt,
					completedAt: new Date().toISOString(),
					settleWaitSeconds: parameters.waitSeconds,
					reason: 'duration_elapsed_after_settlement_wait',
				},
			});
		}
	}
	const actualProjects = await collectCapacityWorkdayResults({
		client, teamId, providerId, runId, projectStates, waitedAssignmentSnapshots,
		waitTimedOutAssignmentIds, durationWindow, completedDurationWorkdayIds, parameters, event,
	});
	const metrics = capacityWorkdayScore({
		expectedProjects: projectSlugs,
		actualProjects,
		providerReady,
		auditEvents: eventCount,
		planningOnly: parameters.planningOnly,
	});
	const reportRefs = await writeWorkdayRunReportFiles(context, {
		runId,
		reportDir: parameters.reportDir,
		parameters,
		expected: { projects: projectSlugs, agentCountsByProject: Object.fromEntries(projectStates.map((state) => [state.slug, state.contentAgentCount])) },
		actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
		metrics,
	});
	await client.updateWorkdayRun(teamId, runId, {
		status: metrics.status,
		completedAt: new Date().toISOString(),
		summary: {
			score: metrics.score,
			status: metrics.status,
			projectCount: actualProjects.length,
			blockerCount: metrics.blockers.length,
		},
		metrics,
		actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
		reportRefs,
		error: metrics.status === 'failed' ? { blockers: metrics.blockers } : {},
	});
	const abortFailure = parameters.abortOnDegradation && metrics.status !== 'completed';
	await event({
		eventType: abortFailure ? 'command.aborted' : 'command.completed',
		status: abortFailure ? 'failed' : metrics.status,
		title: abortFailure ? 'Workday aborted after degradation' : 'Workday command completed',
		refs: reportRefs,
		context: abortFailure ? { blockers: metrics.blockers, score: metrics.score } : {},
	});
	return guidedResult({
		command: 'capacity workday-run',
		summary: abortFailure
			? `Workday ${runId} aborted after status ${metrics.status} and score ${metrics.score}.`
			: `Workday ${runId} finished with status ${metrics.status} and score ${metrics.score}.`,
		facts: [
			{ label: 'Market', value: `${profile.id} (${profile.baseUrl})` },
			{ label: 'Team', value: teamId },
			{ label: 'Provider', value: providerId },
			{ label: 'Projects', value: actualProjects.length },
			{ label: 'Score', value: metrics.score },
			{ label: 'JSON report', value: reportRefs.jsonPath },
			{ label: 'Markdown report', value: reportRefs.markdownPath },
		],
		sections: [
			{ title: 'Checks', lines: metrics.checks.map((check) => `${check.name}: ${check.actual}/${check.expected} (${check.score})`) },
			{ title: 'Blockers', lines: metrics.blockers.length ? metrics.blockers : ['none'] },
		],
		exitCode: abortFailure || metrics.status === 'failed' ? 1 : 0,
		report: {
			runId,
			parameters,
			metrics,
			actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
			reportRefs,
		},
	});
}



export const handleCapacity: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'doctor';
	if (CAPACITY_PROVIDER_GOVERNANCE_ACTIONS.has(action)) {
		try {
			return await runCapacityProviderGovernanceAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (CAPACITY_GOVERNANCE_ACTIONS.has(action)) {
		try {
			return await runCapacityGovernanceAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (CAPACITY_WORKDAY_ACTIONS.has(action)) {
		try {
			return await runCapacityWorkdayAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (CAPACITY_ASSIGNMENT_ACTIONS.has(action)) {
		try {
			return await runCapacityAssignmentAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (CAPACITY_CHECKPOINT_INTEGRATION_ACTIONS.has(action)) {
		try { return await runCapacityCheckpointIntegration(invocation, context); }
		catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
	if (CAPACITY_OVERRUN_ACTIONS.has(action)) {
		try { return await runCapacityOverrunAction(action, invocation, context); }
		catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
	if (CAPACITY_EVIDENCE_ACTIONS.has(action)) {
		try { return await runCapacityEvidenceAction(action, invocation, context); }
		catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
	if (CAPACITY_AGENT_CLASS_ACTIONS.has(action)) {
		try { return await runCapacityAgentClassAction(action, invocation, context); }
		catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
	if (action === 'diagnostics') {
		try {
			return runCapacityDiagnostics(invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (action === 'workday-run') {
		try { return await runWorkdayRun(invocation, context); }
		catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
	if (action === 'execution-runs' || action === 'workday-log') {
		try { return await runExecutionRunsInspection(invocation, context, action === 'workday-log' ? { action: 'workday-log' } : {}); }
		catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
	}
	if (CAPACITY_MARKET_INSPECTION_ACTIONS.has(action)) {
		try {
			return await runCapacityMarketInspection(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (PROVIDER_LIFECYCLE_ACTIONS.has(action)) {
		try {
			return await runCapacityLifecycleAction(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	if (PROVIDER_ENTRYPOINT_ACTIONS.has(action)) {
		try {
			return await runCapacityProviderEntrypoint(action, invocation, context);
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error));
		}
	}
	return fail(`Unknown capacity action "${action}". Use registration-key operations, provider request/membership operations, grants, allocation operations, workday-create, workday-start, workday-pause, workday-resume, workday-tick, workday-complete, workday-cancel, workday-status, workday-summary, assignment-cancel, assignment-requeue, checkpoint-integrate, overrun-approve, overrun-reject, provider runtime lifecycle, or inspection actions.`);
};
