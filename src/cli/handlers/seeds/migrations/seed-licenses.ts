import { applyPortfolioLicense, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planPortfolioLicense } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedLicenses: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	const project = typeof invocation.args.project === 'string' ? invocation.args.project.trim() : '';
	if (!seedName || !project) return { exitCode: 1, stderr: ['Usage: trsd seed licenses <name> --project <slug> [--plan|--apply --yes]'], report: { command: 'seed licenses', ok: false, error: 'Seed name and project are required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed licenses', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['License migration pushes file-scoped fast-forward commits. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed licenses', ok: false, error: 'Confirmation required.' } };
	if (!live) {
		const plan = await planPortfolioLicense({ projectRoot: context.cwd, manifest: compiled.manifest, project, env: context.env });
		return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : plan.branches.map((branch) => `${branch.branch}: ${branch.action} (${branch.reason})`), stderr: [], report: { command: 'seed licenses', ok: true, mode: 'plan', seed: seedName, plan } };
	}
	const result = await applyPortfolioLicense({ projectRoot: context.cwd, manifest: compiled.manifest, project, env: context.env });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`Applied and verified ${result.license} in ${result.repository}.`, `Journal: ${result.journalPath}`], stderr: [], report: { command: 'seed licenses', ok: true, mode: 'apply', seed: seedName, result } };
};
