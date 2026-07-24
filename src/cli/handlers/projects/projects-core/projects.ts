import { MarketClientError } from '@treeseed/sdk/market-client';
import {
	githubRepositoryCredentialEnvName,
	parseProjectLaunchHostBindingSpecs,
	planRepositoryImport,
} from '@treeseed/sdk';
import type { ProjectDeploymentEnvironment, ProjectWebDeploymentAction } from '@treeseed/sdk';
import type { CommandContext, CommandHandler, ParsedInvocation } from '../../../types.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import {
	ACTIONS,
	architectureSummary,
	authFailure,
	boolArg,
	deploymentApiExitCode,
	deploymentLine,
	deploymentRequestBody,
	deploymentUrl,
	environmentArg,
	handleProjectImport,
	hostBindingForMarket,
	hostBindingLine,
	inspectCommand,
	monitorExitCode,
	monitorFacts,
	monitorSection,
	normalizeRepeatable,
	operationFacts,
	pollIntervalMs,
	projectUsage,
	redact,
	retryCommand,
	stringArg,
	timeoutSeconds,
	waitForDeployment,
	workflowUrl,
} from './projects-support.js';

export const handleProjects: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	if (action === 'import') {
		try {
			return await handleProjectImport(invocation, context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return guidedResult({
				command: 'projects import',
				summary: message,
				exitCode: 1,
				stderr: [message],
				report: { ok: false, error: message },
			});
		}
	}
	let market;
	try {
		market = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	} catch (error) {
		return authFailure(error) ?? fail(error instanceof Error ? error.message : String(error), 1);
	}
	const { profile, client } = market;

	try {
		if (action === 'list') {
			const teamId = typeof invocation.args.team === 'string' ? invocation.args.team : null;
			const response = await client.projects(teamId);
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed market projects',
				sections: [{
					title: 'Projects',
					lines: response.payload.map((project: any) => `${project.id}  ${project.name ?? project.slug}  team=${project.teamId}  ${architectureSummary(project)}`),
				}],
				report: { marketId: profile.id, teamId, projects: redact(response.payload) },
			});
		}
		if (action === 'access') {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			const response = await client.projectAccess(projectId);
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed market project access',
				facts: [
					{ label: 'Project', value: response.payload.projectId },
					{ label: 'Staging admin', value: response.payload.team.summary.canAdminStaging },
					{ label: 'Production admin', value: response.payload.team.summary.canAdminProduction },
				],
				sections: [{
					title: 'Environments',
					lines: response.payload.environments.map((entry) => `${entry.environment}: ${entry.role}`),
				}],
				report: { marketId: profile.id, access: redact(response.payload) },
			});
		}
		if (action === 'hosts') {
			const subaction = ['audit', 'replace', 'resync', 'rotate'].includes(String(invocation.positionals[1]))
				? String(invocation.positionals[1])
				: 'list';
			const projectId = subaction === 'list' ? invocation.positionals[1] : invocation.positionals[2];
			if (!projectId) return fail(projectUsage(action));
			if (subaction === 'list') {
				const response = await client.projectHosts(projectId);
				const view = (response.payload as any).view ?? {};
				return guidedResult({
					command: 'projects',
					summary: 'Treeseed project host bindings',
					facts: [
						{ label: 'Project', value: projectId },
						{ label: 'Status', value: view.summary?.status ?? 'ok' },
						{ label: 'Requirements', value: view.summary?.total ?? 0 },
					],
					sections: [{
						title: 'Host requirements',
						lines: (view.requirements ?? []).map(hostBindingLine),
					}],
					report: { marketId: profile.id, projectId, hosts: redact(response.payload) },
				});
			}
			if (subaction === 'audit') {
				const response = await client.auditProjectHosts(projectId, {
					idempotencyKey: stringArg(invocation, 'idempotencyKey'),
				});
				const view = (response.payload as any).view ?? {};
				return guidedResult({
					command: 'projects',
					summary: 'Treeseed project host audit',
					facts: [
						{ label: 'Project', value: projectId },
						{ label: 'Status', value: view.summary?.status ?? 'ok' },
						{ label: 'Warnings', value: view.summary?.warnings ?? 0 },
						{ label: 'Blocked', value: view.summary?.blocked ?? 0 },
					],
					sections: [{
						title: 'Diagnostics',
						lines: (view.diagnostics ?? []).map((entry: any) => `${entry.status}  ${entry.requirementKey ?? ''}  ${entry.message}`),
					}],
					report: { marketId: profile.id, projectId, audit: redact(response.payload) },
				});
			}
			const hostSpecs = normalizeRepeatable(invocation.args.host);
			const hostSnapshot = await client.projectHosts(projectId);
			const launchRequirements = (hostSnapshot.payload as any).launchRequirements ?? null;
			let requirementKey = stringArg(invocation, 'requirement');
			let hostBinding: Record<string, unknown> | null = null;
			if (subaction === 'replace') {
				if (hostSpecs.length !== 1) return fail('Host replacement requires exactly one --host <requirement=provider:host-id|managed> spec.');
				try {
					const parsed = parseProjectLaunchHostBindingSpecs({ specs: hostSpecs, launchRequirements });
					requirementKey = requirementKey ?? parsed.summaries[0]?.requirementKey ?? parsed.omitted[0]?.requirementKey ?? null;
					if (!requirementKey) return fail('Host replacement could not determine a launch requirement key.');
					hostBinding = hostBindingForMarket(parsed, requirementKey);
					if (!hostBinding) return fail('Host replacement could not normalize the selected host binding.');
				} catch (error) {
					return fail(error instanceof Error ? error.message : String(error));
				}
			}
			if (!requirementKey) return fail(`${subaction} requires --requirement <key>.`);
			if (stringArg(invocation, 'sensitivePassphrase')) {
				return fail('Project host operations no longer accept --sensitive-passphrase. Re-enter or migrate the host secret into an approved target, then retry the operation.');
			}
			const body = {
				...(hostBinding ? { hostBinding } : {}),
				...(stringArg(invocation, 'idempotencyKey') ? { idempotencyKey: stringArg(invocation, 'idempotencyKey') } : {}),
			};
			const response = subaction === 'replace'
				? await client.replaceProjectHost(projectId, requirementKey, body)
				: subaction === 'resync'
					? await client.resyncProjectHost(projectId, requirementKey, body)
					: await client.rotateProjectHost(projectId, requirementKey, body);
			const view = (response.payload as any).view ?? {};
			return guidedResult({
				command: 'projects',
				summary: `Treeseed project host ${subaction} queued`,
				facts: operationFacts(projectId, response),
				sections: [{
					title: 'Host requirements',
					lines: (view.requirements ?? []).map(hostBindingLine),
				}],
				nextSteps: response.operation?.id ? [`trsd projects hosts ${projectId}`, `trsd operations ${response.operation.id}`] : [`trsd projects hosts ${projectId}`],
				report: { marketId: profile.id, projectId, response: redact(response) as Record<string, unknown> },
			});
		}
		if (action === 'connect') {
			return fail('Use treeseed config --connect-market --market-project-id <project-id> for project pairing.');
		}
		if (action in ACTIONS) {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			const environment = environmentArg(invocation);
			const deploymentAction = ACTIONS[action];
			if (environment === 'prod' && deploymentAction !== 'monitor' && !boolArg(invocation, 'yes')) {
				return fail(`Production ${action} requires --yes and was not queued.`);
			}
			const response = await client.createProjectWebDeployment(projectId, deploymentRequestBody(invocation, deploymentAction, environment));
			let deployment = response.deployment;
			let waitResult: Awaited<ReturnType<typeof waitForDeployment>> | null = null;
			if (boolArg(invocation, 'wait')) {
				waitResult = await waitForDeployment({
					client,
					projectId,
					deploymentId: deployment.id,
					timeoutSeconds: timeoutSeconds(invocation),
					pollIntervalMs: pollIntervalMs(invocation),
				});
				deployment = waitResult.deployment;
			}
			const exitCode = monitorExitCode(deployment, waitResult?.exitCode ?? 0);
			const summary = waitResult
				? waitResult.timedOut
					? 'Treeseed project deployment wait timed out'
					: deployment.status === 'succeeded'
						? 'Treeseed project deployment completed'
						: `Treeseed project deployment ${deployment.status}`
				: 'Treeseed project deployment queued';
			const nextSteps = [
				inspectCommand(projectId, deployment.id),
				...(['failed', 'timed_out', 'cancelled'].includes(deployment.status) ? [retryCommand(projectId, deployment.id)] : []),
			];
			return guidedResult({
				command: 'projects',
				summary,
				exitCode,
				facts: [
					{ label: 'Project', value: projectId },
					{ label: 'Environment', value: deployment.environment },
					{ label: 'Action', value: deployment.action },
					{ label: 'Deployment', value: deployment.id },
					{ label: 'Operation', value: deployment.platformOperationId ?? (response.operation as any)?.id ?? null },
					{ label: 'Status', value: deployment.status },
					{ label: 'URL', value: deploymentUrl(deployment) || null },
					{ label: 'Workflow', value: workflowUrl(deployment) || null },
					...monitorFacts(deployment),
				],
				sections: monitorSection(deployment),
				nextSteps,
				report: {
					marketId: profile.id,
					projectId,
					deployment: redact(deployment),
					operation: redact(response.operation),
					pollUrl: response.pollUrl,
					eventsUrl: response.eventsUrl,
					stateUrl: response.stateUrl,
					wait: waitResult ? { timedOut: waitResult.timedOut, exitCode } : null,
				},
			});
		}
		if (action === 'deployments') {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			const response = await client.projectDeployments(projectId, {
				environment: stringArg(invocation, 'environment'),
				limit: stringArg(invocation, 'limit'),
			});
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed project deployments',
				sections: [{
					title: 'Deployments',
					lines: response.payload.map(deploymentLine),
				}],
				report: { marketId: profile.id, projectId, deployments: redact(response.payload) },
			});
		}
		if (action === 'deployment') {
			const subaction = invocation.positionals[1];
			const projectId = ['retry', 'resume', 'cancel'].includes(String(subaction)) ? invocation.positionals[2] : invocation.positionals[1];
			const deploymentId = ['retry', 'resume', 'cancel'].includes(String(subaction)) ? invocation.positionals[3] : invocation.positionals[2];
			if (!projectId || !deploymentId) return fail(projectUsage(action));
			if (subaction === 'retry') {
				const response = await client.retryProjectDeployment(projectId, deploymentId, {
					...(stringArg(invocation, 'idempotencyKey') ? { idempotencyKey: stringArg(invocation, 'idempotencyKey') } : {}),
				});
				return guidedResult({
					command: 'projects',
					summary: 'Treeseed project deployment retry queued',
					facts: [
						{ label: 'Original deployment', value: response.originalDeployment.id },
						{ label: 'Retry deployment', value: response.retryDeployment.id },
						{ label: 'Operation', value: (response.operation as any)?.id ?? response.retryDeployment.platformOperationId },
						{ label: 'Status', value: response.retryDeployment.status },
					],
					nextSteps: [inspectCommand(projectId, response.retryDeployment.id)],
					report: { marketId: profile.id, projectId, originalDeployment: redact(response.originalDeployment), retryDeployment: redact(response.retryDeployment), operation: redact(response.operation) },
				});
			}
			if (subaction === 'resume') {
				try {
					const response = await client.resumeProjectDeployment(projectId, deploymentId);
					return guidedResult({
						command: 'projects',
						summary: 'Treeseed project deployment resume queued',
						report: { marketId: profile.id, projectId, response: redact(response) as Record<string, unknown> },
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return guidedResult({
						command: 'projects',
						summary: message,
						exitCode: deploymentApiExitCode(error),
						stderr: [message],
						report: { marketId: profile.id, projectId, deploymentId, ok: false, error: message },
					});
				}
			}
			if (subaction === 'cancel') {
				const response = await client.cancelProjectDeployment(projectId, deploymentId);
				const exitCode = response.deployment.status === 'cancelled' ? 5 : 0;
				return guidedResult({
					command: 'projects',
					summary: response.deployment.status === 'cancelled' ? 'Treeseed project deployment cancelled' : 'Treeseed project deployment cancellation requested',
					exitCode,
					facts: [
						{ label: 'Deployment', value: response.deployment.id },
						{ label: 'Status', value: response.deployment.status },
						{ label: 'Cancellation', value: response.cancellation },
					],
					report: { marketId: profile.id, projectId, deployment: redact(response.deployment), cancellation: response.cancellation },
				});
			}
			const [deploymentResponse, eventsResponse] = await Promise.all([
				client.projectDeployment(projectId, deploymentId),
				client.projectDeploymentEvents(projectId, deploymentId),
			]);
			const deployment = deploymentResponse.payload;
			return guidedResult({
				command: 'projects',
				summary: 'Treeseed project deployment',
				facts: [
					{ label: 'Project', value: projectId },
					{ label: 'Deployment', value: deployment.id },
					{ label: 'Environment', value: deployment.environment },
					{ label: 'Action', value: deployment.action },
					{ label: 'Status', value: deployment.status },
					{ label: 'URL', value: deploymentUrl(deployment) || null },
					{ label: 'Workflow', value: workflowUrl(deployment) || null },
					...monitorFacts(deployment),
				],
				sections: [{
					title: 'Events',
					lines: eventsResponse.payload.map((event) => `${event.sequence}  ${event.kind}  ${event.status ?? ''}  ${event.message}`),
				}, ...monitorSection(deployment)],
				nextSteps: ['failed', 'timed_out', 'cancelled'].includes(deployment.status) ? [retryCommand(projectId, deployment.id)] : [],
				report: { marketId: profile.id, projectId, deployment: redact(deployment), events: redact(eventsResponse.payload) },
			});
		}
		return fail(`Unknown projects action: ${action}`);
	} catch (error) {
		const auth = authFailure(error);
		if (auth) return auth;
		const message = error instanceof Error ? error.message : String(error);
		return guidedResult({
			command: 'projects',
			summary: message,
			exitCode: deploymentApiExitCode(error),
			stderr: [message],
			report: { marketId: profile.id, ok: false, error: message },
		});
	}
};
