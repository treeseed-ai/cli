import { applyOrganizationReferenceMigration, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planOrganizationReferenceMigration } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedOrganizationReferences: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	if (!seedName) return { exitCode: 1, stderr: ['Usage: trsd seed organization-references <name> [--plan|--apply --yes]'], report: { command: 'seed organization-references', ok: false, error: 'Seed name is required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed organization-references', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Organization-reference migration pushes bounded commits. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed organization-references', ok: false, error: 'Confirmation required.' } };
	const result = live
		? await applyOrganizationReferenceMigration({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env })
		: await planOrganizationReferenceMigration({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : result.plans.map((plan) => `${plan.repository}@${plan.branch}: ${plan.action} (${plan.files.length} files)`), stderr: [], report: { command: 'seed organization-references', ok: true, mode: live ? 'apply' : 'plan', seed: seedName, result } };
};
