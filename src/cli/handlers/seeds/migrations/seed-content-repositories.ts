import { applySeedContentRepositoryHistory, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planSeedContentRepositoryHistory } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedContentRepositories: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	const project = typeof invocation.args.project === 'string' ? invocation.args.project.trim() : '';
	if (!seedName) return { exitCode: 1, stderr: ['Usage: trsd seed content-repositories <name> [--project <slug>] [--plan|--apply --yes]'], report: { command: 'seed content-repositories', ok: false, error: 'Missing seed name.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed content-repositories', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && !project) return { exitCode: 1, stderr: ['Apply requires one explicit --project slug so each history migration is reviewed and journaled independently.'], report: { command: 'seed content-repositories', ok: false, error: 'Explicit --project is required for apply.' } };
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Content history migration pushes main and staging. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed content-repositories', ok: false, error: 'Confirmation required.' } };
	if (!live) {
		const plans = await planSeedContentRepositoryHistory({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env, ...(project ? { project } : {}) });
		const blocked = plans.some((plan) => plan.branches.some((branch) => branch.action === 'blocked'));
		return {
			exitCode: blocked ? 2 : 0,
			stdout: context.outputFormat === 'json' ? [] : plans.flatMap((plan) => [`${plan.project}: ${plan.sourceRepository} -> ${plan.targetRepository}`, ...plan.branches.map((branch) => `  ${branch.branch}: ${branch.action} (${branch.reason})`)]),
			stderr: [],
			report: { command: 'seed content-repositories', ok: !blocked, mode: 'plan', seed: seedName, plans },
		};
	}
	const result = await applySeedContentRepositoryHistory({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env, project });
	return {
		exitCode: 0,
		stdout: context.outputFormat === 'json' ? [] : [`Migrated and verified ${result.targetRepository} history for ${result.receipts.map((receipt) => receipt.branch).join(', ')}.`, `Journal: ${result.journalPath}`],
		stderr: [],
		report: { command: 'seed content-repositories', ok: true, mode: 'apply', seed: seedName, result },
	};
};
