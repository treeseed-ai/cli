import { applySeedSourceRepositoryHistory, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planSeedSourceRepositoryHistory } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedSourceRepositories: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	const project = typeof invocation.args.project === 'string' ? invocation.args.project.trim() : '';
	if (!seedName || !project) return { exitCode: 1, stderr: ['Usage: trsd seed source-repositories <name> --project <slug> [--plan|--apply --yes]'], report: { command: 'seed source-repositories', ok: false, error: 'Seed name and explicit project are required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed source-repositories', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Source history migration pushes exact branches. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed source-repositories', ok: false, error: 'Confirmation required.' } };
	if (!live) {
		const plan = await planSeedSourceRepositoryHistory({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env, project });
		const blocked = plan.branches.some((branch) => branch.action === 'blocked');
		return { exitCode: blocked ? 2 : 0, stdout: context.outputFormat === 'json' ? [] : [`${project}: ${plan.sourcePath} -> ${plan.targetRepository}`, ...plan.branches.map((branch) => `  ${branch.branch}: ${branch.action} (${branch.reason})`)], stderr: [], report: { command: 'seed source-repositories', ok: !blocked, mode: 'plan', seed: seedName, plan } };
	}
	const result = await applySeedSourceRepositoryHistory({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env, project });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`Migrated and verified ${result.targetRepository} source history.`, `Journal: ${result.journalPath}`], stderr: [], report: { command: 'seed source-repositories', ok: true, mode: 'apply', seed: seedName, result } };
};
