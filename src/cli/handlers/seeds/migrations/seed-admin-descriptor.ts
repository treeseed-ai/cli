import { applyAdminDescriptorMigration, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planAdminDescriptorMigration } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedAdminDescriptor: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	if (!seedName) return { exitCode: 1, stderr: ['Usage: trsd seed admin-descriptor <name> [--plan|--apply --yes]'], report: { command: 'seed admin-descriptor', ok: false, error: 'Seed name is required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed admin-descriptor', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Admin descriptor migration pushes a scoped staging commit. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed admin-descriptor', ok: false, error: 'Confirmation required.' } };
	if (!live) {
		const plan = await planAdminDescriptorMigration({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env });
		return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`staging: ${plan.action} (${plan.reason})`], stderr: [], report: { command: 'seed admin-descriptor', ok: true, mode: 'plan', seed: seedName, plan } };
	}
	const result = await applyAdminDescriptorMigration({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`Published and verified the Admin descriptor build contract at ${result.targetCommit}.`], stderr: [], report: { command: 'seed admin-descriptor', ok: true, mode: 'apply', seed: seedName, result } };
};
