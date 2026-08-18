import { applySupportRepositoryWorkflow, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planSupportRepositoryWorkflow } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedSupportWorkflows: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	const repository = typeof invocation.args.project === 'string' ? invocation.args.project.trim() : '';
	if (!seedName || !repository) return { exitCode: 1, stderr: ['Usage: trsd seed support-workflows <name> --project <repository> [--plan|--apply --yes]'], report: { command: 'seed support-workflows', ok: false, error: 'Seed name and support repository are required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed support-workflows', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Support workflow migration pushes fast-forward commits. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed support-workflows', ok: false, error: 'Confirmation required.' } };
	if (!live) {
		const plan = await planSupportRepositoryWorkflow({ projectRoot: context.cwd, manifest: compiled.manifest, repository, env: context.env });
		const blocked = plan.branches.some((branch) => branch.action === 'blocked');
		return { exitCode: blocked ? 2 : 0, stdout: context.outputFormat === 'json' ? [] : plan.branches.map((branch) => `${branch.branch}: ${branch.action} (${branch.reason})`), stderr: [], report: { command: 'seed support-workflows', ok: !blocked, mode: 'plan', seed: seedName, plan } };
	}
	const result = await applySupportRepositoryWorkflow({ projectRoot: context.cwd, manifest: compiled.manifest, repository, env: context.env });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`Added and verified ${result.repository} workflows.`, `Journal: ${result.journalPath}`], stderr: [], report: { command: 'seed support-workflows', ok: true, mode: 'apply', seed: seedName, result } };
};
