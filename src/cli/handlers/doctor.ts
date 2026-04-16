import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TreeseedCommandHandler } from '../types.js';
import { collectCliPreflight } from '@treeseed/sdk/workflow-support';
import { guidedResult } from './utils.js';
import { applyTreeseedSafeRepairs } from '../repair.js';
import { createWorkflowSdk, workflowErrorResult } from './workflow.js';

export const handleDoctor: TreeseedCommandHandler = async (invocation, context) => {
	try {
	const status = await createWorkflowSdk(context).status();
	const state = status.payload;
	const performedFixes = invocation.args.fix === true && state.deployConfigPresent
		? applyTreeseedSafeRepairs(state.cwd)
		: [];
	const preflight = collectCliPreflight({ cwd: context.cwd, requireAuth: false });
	const railwayManagedServicesEnabled = Object.values(state.managedServices).some((service) => service.enabled);
	const mustFixNow: string[] = [];
	const optional: string[] = [];

	if (!state.workspaceRoot) mustFixNow.push('Run Treeseed inside a Treeseed workspace so package commands and workflow state can resolve correctly.');
	if (!state.repoRoot) mustFixNow.push('Initialize or clone the git repository before using save, close, stage, or release flows.');
	if (!state.deployConfigPresent) mustFixNow.push('Create or restore treeseed.site.yaml so the tenant contract can be loaded.');
	if (preflight.missingCommands.includes('git')) mustFixNow.push('Install Git.');
	if (preflight.missingCommands.includes('npm')) mustFixNow.push('Install npm 10 or newer.');
	if (!state.files.machineConfig) mustFixNow.push('Run `treeseed config --environment local` to create the local machine config.');
	if (state.packageSync.blockers.length > 0) mustFixNow.push(...state.packageSync.blockers);
	if (state.workflowControl.lock.active && state.workflowControl.lock.runId) {
		mustFixNow.push(`Active workflow lock detected for run ${state.workflowControl.lock.runId}. Use \`treeseed recover\` before starting another mutating command.`);
	}
	if (state.workflowControl.interruptedRuns.length > 0) {
		mustFixNow.push(`Interrupted workflow runs detected. Resume the latest run with \`treeseed resume ${state.workflowControl.interruptedRuns[0].runId}\` or inspect \`treeseed recover\`.`);
	}
	if (state.packageSync.completeCheckout) {
		for (const repo of state.packageSync.repos) {
			const publishWorkflowPath = resolve(state.cwd, repo.path, '.github', 'workflows', 'publish.yml');
			if (!existsSync(publishWorkflowPath)) {
				mustFixNow.push(`${repo.name} is missing .github/workflows/publish.yml required for recursive release.`);
			}
		}
	}
	for (const workflowName of ['verify.yml', 'deploy.yml']) {
		const workflowPath = resolve(state.cwd, '.github', 'workflows', workflowName);
		if (!existsSync(workflowPath)) {
			mustFixNow.push(`Missing root workflow contract .github/workflows/${workflowName}.`);
		}
	}

	if (!state.files.envLocal) optional.push('Create `.env.local` or run `treeseed config --environment local` to generate it.');
	if (!state.files.devVars) optional.push('Generate `.dev.vars` by running `treeseed config --environment local`.');
	if (!state.auth.gh) optional.push('Configure `GH_TOKEN` for GitHub CLI automation and Copilot-backed workflows.');
	if (!state.auth.wrangler) optional.push('Configure `CLOUDFLARE_API_TOKEN` before staging, preview, or production deployment work.');
	if (!state.auth.railway && railwayManagedServicesEnabled) {
		optional.push('Configure `RAILWAY_API_TOKEN` before deploying the managed Railway services.');
	}
	if (!state.auth.remoteApi && state.managedServices.api.enabled) {
		optional.push('Run `treeseed auth:login` so the CLI can use the configured remote API.');
	}
	if (!state.auth.copilot) optional.push('Configure `GH_TOKEN` if you rely on local Copilot-assisted workflows.');

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
			...status,
			state,
			preflight,
			performedFixes,
			mustFixNow,
			optional,
		},
		exitCode: mustFixNow.length === 0 ? 0 : 1,
	});
	} catch (error) {
		return workflowErrorResult(error);
	}
};
