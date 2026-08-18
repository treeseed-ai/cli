import type { CommandHandler } from '../../../types.js';
import { createMarketClientForInvocation } from '../../content/market-utils.js';
import { fail, guidedResult } from '../../utilities/utils.js';
import {
	architectureSummary,
	authFailure,
	projectUsage,
	redact,
} from './projects-support.js';

export const handleProjects: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	let market;
	try {
		market = createMarketClientForInvocation(invocation, context, { requireAuth: true, allowLocalAcceptanceAdmin: true });
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
				summary: 'TreeSeed projects',
				sections: [{
					title: 'Projects',
					lines: response.payload.map((project: any) =>
						`${project.id}  ${project.name ?? project.slug}  team=${project.teamId}  ${architectureSummary(project)}`),
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
				summary: 'TreeSeed project access',
				facts: [
					{ label: 'Project', value: response.payload.projectId },
					{ label: 'Roles', value: response.payload.roles.join(', ') || 'none' },
				],
				report: { marketId: profile.id, access: redact(response.payload) },
			});
		}

		if (action === 'archive' || action === 'restore') {
			const projectId = invocation.positionals[1];
			if (!projectId) return fail(projectUsage(action));
			if (invocation.args.execute !== true) return guidedResult({
				command: 'projects', summary: `Plan to ${action} project inventory membership`,
				report: { marketId: profile.id, executionMode: 'plan', method: 'POST', path: `/v1/projects/${encodeURIComponent(projectId)}/${action}`, projectId },
			});
			const response = action === 'archive' ? await client.archiveProject(projectId) : await client.restoreProject(projectId);
			return guidedResult({ command: 'projects', summary: `Project ${action} completed`, report: { marketId: profile.id, executionMode: 'execute', project: redact(response.payload) } });
		}

		return fail(`Unknown projects action: ${action}`);
	} catch (error) {
		const auth = authFailure(error);
		return auth ?? fail(error instanceof Error ? error.message : String(error), 1);
	}
};
