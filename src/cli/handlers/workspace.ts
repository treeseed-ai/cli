import {
	ensureLocalWorkspaceLinks,
	findNearestTreeseedWorkspaceRoot,
	inspectWorkspaceDependencyMode,
	unlinkLocalWorkspaceLinks,
} from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../types.js';
import { guidedResult } from './utils.js';
import { workflowErrorResult } from './workflow.js';

const workspaceCommand = (name: 'status' | 'link' | 'unlink') => `workspace${':'}${name}`;

function workspaceRootOrThrow(cwd: string) {
	const root = findNearestTreeseedWorkspaceRoot(cwd);
	if (!root) {
		throw new Error('Treeseed workspace commands must run inside a workspace with checked-out packages.');
	}
	return root;
}

function facts(report: ReturnType<typeof inspectWorkspaceDependencyMode>) {
	return [
		{ label: 'Dependency mode', value: report.mode },
		{ label: 'Workspace links enabled', value: report.enabled ? 'yes' : 'no' },
		{ label: 'Links', value: String(report.links.length) },
		{ label: 'Linked', value: String(report.links.filter((link) => link.linked && link.targetMatches).length) },
		{ label: 'Created', value: String(report.created.length) },
		{ label: 'Removed', value: String(report.removed.length) },
		{ label: 'Issues', value: report.issues.length > 0 ? report.issues.join(' | ') : '(none)' },
	];
}

export const handleWorkspace: TreeseedCommandHandler = async (invocation, context) => {
	try {
		const root = workspaceRootOrThrow(context.cwd);
		const linkCommand = workspaceCommand('link');
		const unlinkCommand = workspaceCommand('unlink');
		const statusCommand = workspaceCommand('status');
		const report = invocation.commandName === linkCommand
			? ensureLocalWorkspaceLinks(root, { env: context.env })
			: invocation.commandName === unlinkCommand
				? unlinkLocalWorkspaceLinks(root, { env: context.env })
				: inspectWorkspaceDependencyMode(root, { env: context.env });
		return guidedResult({
			command: invocation.commandName || statusCommand,
			summary: invocation.commandName === linkCommand
				? 'Treeseed local workspace links are ready.'
				: invocation.commandName === unlinkCommand
					? 'Treeseed local workspace links were removed.'
					: 'Treeseed workspace dependency mode',
			facts: facts(report),
			report: {
				ok: true,
				command: invocation.commandName || statusCommand,
				payload: report,
			},
		});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
