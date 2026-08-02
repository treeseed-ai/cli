import { createHash, randomUUID } from 'node:crypto';
import { normalizeWorkdayAgentSelection, selectWorkdayAgents } from '@treeseed/sdk/agent-capacity';
import type { CommandContext, CommandHandler, ParsedInvocation } from '../../../types.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { resolveCapacityWorkdayProviderId } from '../workdays/configuration/capacity-workday-provider.js';
import { capacityBooleanArg as booleanArg, capacityCsvArg as csvArg, capacityFlagArg as boolArg, capacityPositiveNumberArg as positiveNumberArg, capacityProviderSelector as providerSelector, capacityStringArg as stringArg } from './capacity-command-arguments.js';
import { PROVIDER_ENTRYPOINT_ACTIONS, PROVIDER_LIFECYCLE_ACTIONS } from './capacity-runtime.js';
import { capacityCollectionItems as collectionItems, capacityRecordValue as recordValue, isCapacityRecord as isRecord } from './capacity-values.js';
import { createCapacityMarketClient as createCapacityWorkdayMarketClient, resolveCapacityTeam as resolveCapacityWorkdayTeam } from './capacity-market-context.js';
import { CAPACITY_MARKET_INSPECTION_ACTIONS } from './capacity-market-inspection.js';
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
import { routeCapacityAction } from './routing/capacity-action-router.js';

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
	const classSelectors = csvArg(invocation, 'agentClasses', []);
	const agentSelection = normalizeWorkdayAgentSelection({
		classIds: classSelectors.filter((value) => value.includes(':')),
		classSlugs: classSelectors.filter((value) => !value.includes(':')),
		agentSlugs: csvArg(invocation, 'agents', []),
		mode: stringArg(invocation, 'selectionMode'),
	});
	const requiredAgentCount = positiveNumberArg(invocation, 'requireAgents', 0);
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
		agentSelection,
		requiredAgentCount,
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
		const selectedContentAgents = selectWorkdayAgents(preparedAgents.contentAgents, agentSelection);
		const selectionBlockers = selectedContentAgents.length === 0
			? ['workday agent selection resolved no eligible agents']
			: requiredAgentCount > 0 && selectedContentAgents.length !== requiredAgentCount
				? [`workday agent selection resolved ${selectedContentAgents.length} agents; expected ${requiredAgentCount}`]
				: [];
		projectStates.push({
			projectId,
			slug,
			workdayId: safeWorkdayIdPart(`workday-pending-${slug}`),
			agentClasses: preparedAgents.agentClasses,
			contentAgents: selectedContentAgents,
			contentAgentCount: selectedContentAgents.length,
			assignmentIds: [],
			assignmentCount: 0,
			blockers: preparedAgents.contentAgentCount === 0 ? ['no enabled planning activity profiles were found'] : selectionBlockers,
		});
	}
	const selectionBlockers = projectStates.flatMap((state) => state.blockers.map((blocker) => `${state.slug}: ${blocker}`));
	if (selectionBlockers.length > 0 && parameters.mode === 'live') return fail(selectionBlockers.join(' | '));
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
				ok: projectStates.every((state) => state.blockers.length === 0),
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
	const resolvedAgentSelectionByProject = Object.fromEntries(projectStates.map((state) => {
		const agents = state.contentAgents.map((agent) => {
			const agentClass = state.agentClasses.find((candidate) => {
				const id = String(candidate.id ?? '');
				const slug = String(candidate.slug ?? '');
				return id === agent.projectAgentClassId || id.endsWith(`:${agent.projectAgentClassId}`) || slug === agent.projectAgentClassSlug;
			});
			return {
				agentSlug: agent.slug,
				agentClassId: String(agentClass?.id ?? agent.projectAgentClassId),
				agentClassSlug: String(agentClass?.slug ?? agent.projectAgentClassSlug),
				contentPath: agent.contentPath.replace(`${context.cwd}/`, ''),
				activityType: agent.activityType,
				handler: agent.handler,
			};
		});
		const revision = createHash('sha256').update(JSON.stringify(agents)).digest('hex');
		return [state.projectId, { projectId: state.projectId, projectSlug: state.slug, revision, agents }];
	}));
	const runResponse = await client.createWorkdayRun(teamId, {
		capacityProviderId: providerId,
		scenarioId: parameters.purpose,
		status: 'running',
		environment: 'local',
		startedAt: new Date().toISOString(),
		parameters: { ...parameters, repositoryIdsBySlug, resolvedAgentSelectionByProject },
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
			if (waitTimedOutAssignmentIds.size > 0) {
				await event({
					eventType: 'workday.duration.settlement_deferred',
					status: 'warning',
					projectId: projectState.projectId,
					workdayId: projectState.workdayId,
					title: `Deferred terminalization for ${projectState.slug} while assignments settle`,
					context: { assignmentIds: [...waitTimedOutAssignmentIds], deadlineAt: durationWindow.deadlineAt },
				});
				continue;
			}
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
	const settlementDeferred = waitTimedOutAssignmentIds.size > 0;
	const latestRun = await client.workdayRun(teamId, runId);
	const latestRunPayload = recordValue(latestRun, 'payload');
	const latestRunRecord = recordValue(latestRunPayload, 'run');
	const latestStatus = String(recordValue(latestRunRecord, 'status') ?? '');
	if (!settlementDeferred && !['completed', 'cancelled', 'failed', 'degraded'].includes(latestStatus)) {
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
	} else if (!settlementDeferred && latestStatus !== metrics.status) {
		await event({
			eventType: 'command.terminal_state_preserved',
			status: 'warning',
			title: `Preserved control-plane terminal status ${latestStatus}`,
			context: { calculatedStatus: metrics.status, controlPlaneStatus: latestStatus },
		});
	}
	const abortFailure = parameters.abortOnDegradation && metrics.status !== 'completed';
	await event({
		eventType: abortFailure ? 'command.aborted' : settlementDeferred ? 'command.observation_completed' : 'command.completed',
		status: abortFailure ? 'failed' : settlementDeferred ? 'warning' : metrics.status === 'failed' ? 'failed' : metrics.status === 'completed' ? 'completed' : 'warning',
		title: abortFailure ? 'Workday aborted after degradation' : settlementDeferred ? 'Workday observation completed; durable settlement continues' : 'Workday command completed',
		refs: reportRefs,
		context: abortFailure
			? { blockers: metrics.blockers, score: metrics.score }
			: settlementDeferred ? { assignmentIds: [...waitTimedOutAssignmentIds], score: metrics.score } : {},
	});
	return guidedResult({
		command: 'capacity workday-run',
		summary: abortFailure
			? `Workday ${runId} aborted after status ${metrics.status} and score ${metrics.score}.`
			: settlementDeferred
				? `Workday ${runId} observation finished with ${waitTimedOutAssignmentIds.size} assignment(s) still settling under control-plane custody.`
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
		exitCode: abortFailure || (!settlementDeferred && metrics.status === 'failed') ? 1 : 0,
		report: {
			runId,
			settlementDeferred,
			parameters,
			metrics,
			actual: { projects: actualProjects, providerReady, auditEvents: eventCount },
			reportRefs,
		},
	});
}



export const handleCapacity: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'doctor';
	return routeCapacityAction(action, invocation, context, runWorkdayRun);
};
