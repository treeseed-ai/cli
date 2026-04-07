import type { TreeseedCommandHandler } from '../types.js';
import { collectCliPreflight } from '../../../scripts/workspace-preflight-lib.ts';
import { guidedResult } from './utils.js';
import { resolveTreeseedWorkflowState } from '../workflow-state.js';
import { applyTreeseedSafeRepairs } from '../repair.js';

export const handleDoctor: TreeseedCommandHandler = (invocation, context) => {
	const performedFixes = invocation.args.fix === true && resolveTreeseedWorkflowState(context.cwd).deployConfigPresent
		? applyTreeseedSafeRepairs(context.cwd)
		: [];
	const state = resolveTreeseedWorkflowState(context.cwd);
	const preflight = collectCliPreflight({ cwd: context.cwd, requireAuth: false });
	const mustFixNow: string[] = [];
	const optional: string[] = [];

	if (!state.workspaceRoot) mustFixNow.push('Run Treeseed from the workspace root so package commands and workflow state resolve correctly.');
	if (!state.repoRoot) mustFixNow.push('Initialize or clone the git repository before using save, close, deploy, or release flows.');
	if (!state.deployConfigPresent) mustFixNow.push('Create or restore treeseed.site.yaml so the tenant contract can be loaded.');
	if (preflight.missingCommands.includes('git')) mustFixNow.push('Install Git.');
	if (preflight.missingCommands.includes('npm')) mustFixNow.push('Install npm 10 or newer.');
	if (!state.files.machineConfig) mustFixNow.push('Run `treeseed config --environment local` to create the local machine config.');

	if (!state.files.envLocal) optional.push('Create `.env.local` or run `treeseed config --environment local` to generate it.');
	if (!state.files.devVars) optional.push('Generate `.dev.vars` by running `treeseed config --environment local`.');
	if (!state.auth.gh) optional.push('Authenticate `gh` if you want GitHub-backed save or release automation.');
	if (!state.auth.wrangler) optional.push('Authenticate `wrangler` before staging, preview, or production deployment work.');
	if (!state.auth.copilot) optional.push('Configure Copilot CLI only if you rely on local Copilot-assisted workflows.');

	return guidedResult({
		command: 'doctor',
		summary: mustFixNow.length === 0 ? 'Treeseed doctor found no blocking issues.' : 'Treeseed doctor found issues that need attention.',
		facts: [
			{ label: 'Must fix now', value: mustFixNow.length },
			{ label: 'Optional follow-up', value: optional.length },
			{ label: 'Safe fixes applied', value: performedFixes.length },
			{ label: 'Branch', value: state.branchName ?? '(none)' },
			{ label: 'Workspace root', value: state.workspaceRoot ? 'yes' : 'no' },
		],
		nextSteps: [
			...mustFixNow.map((item) => item),
			...(mustFixNow.length === 0 ? optional : optional.map((item) => `Optional: ${item}`)),
		],
		report: {
			state,
			preflight,
			performedFixes,
			mustFixNow,
			optional,
		},
		exitCode: mustFixNow.length === 0 ? 0 : 1,
	});
};
