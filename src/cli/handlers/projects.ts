import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { createMarketClientForInvocation } from './market-utils.js';

export const handleProjects: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'list';
	const { profile, client } = createMarketClientForInvocation(invocation, context, { requireAuth: true });
	if (action === 'list') {
		const teamId = typeof invocation.args.team === 'string' ? invocation.args.team : null;
		const response = await client.projects(teamId);
		return guidedResult({
			command: 'projects',
			summary: 'Treeseed market projects',
			sections: [{
				title: 'Projects',
				lines: response.payload.map((project: any) => `${project.id}  ${project.name ?? project.slug}  team=${project.teamId}`),
			}],
			report: { marketId: profile.id, teamId, projects: response.payload },
		});
	}
	if (action === 'access') {
		const projectId = invocation.positionals[1];
		if (!projectId) return { exitCode: 1, stderr: ['Usage: treeseed projects access <project-id>'] };
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
			report: { marketId: profile.id, access: response.payload },
		});
	}
	if (action === 'connect') {
		return {
			exitCode: 1,
			stderr: ['Use treeseed config --connect-market --market-project-id <project-id> for project pairing.'],
		};
	}
	return { exitCode: 1, stderr: [`Unknown projects action: ${action}`] };
};
