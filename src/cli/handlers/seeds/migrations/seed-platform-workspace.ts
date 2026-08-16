import { applyPlatformWorkspace, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planPlatformWorkspace } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedPlatformWorkspace: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	if (!seedName) return { exitCode: 1, stderr: ['Usage: trsd seed platform-workspace <name> [--plan|--apply --yes]'], report: { command: 'seed platform-workspace', ok: false, error: 'Seed name is required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed platform-workspace', ok: false, diagnostics: compiled.diagnostics } };
	const targetBranch = invocation.args.branch;
	const sourceRef = invocation.args.sourceRef;
	if (targetBranch !== 'main' && targetBranch !== 'staging') return { exitCode: 1, stderr: ['Platform extraction requires --branch main|staging.'], report: { command: 'seed platform-workspace', ok: false, error: 'Explicit target branch required.' } };
	if (typeof sourceRef !== 'string' || !/^[a-f0-9]{40}$/u.test(sourceRef)) return { exitCode: 1, stderr: ['Platform extraction requires --source-ref <exact-commit-sha>.'], report: { command: 'seed platform-workspace', ok: false, error: 'Exact source ref required.' } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Platform extraction pushes filtered workspace branches. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed platform-workspace', ok: false, error: 'Confirmation required.' } };
	if (!live) {
		const plan = await planPlatformWorkspace({ projectRoot: context.cwd, manifest: compiled.manifest, targetBranch, sourceRef, env: context.env });
		const blocked = plan.branches.some((branch) => branch.action === 'blocked');
		return { exitCode: blocked ? 2 : 0, stdout: context.outputFormat === 'json' ? [] : plan.branches.map((branch) => `${branch.branch}: ${branch.action} (${branch.reason})`), stderr: [], report: { command: 'seed platform-workspace', ok: !blocked, mode: 'plan', seed: seedName, plan } };
	}
	const result = await applyPlatformWorkspace({ projectRoot: context.cwd, manifest: compiled.manifest, targetBranch, sourceRef, env: context.env });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`Created and verified ${result.targetRepository}.`, `Journal: ${result.journalPath}`], stderr: [], report: { command: 'seed platform-workspace', ok: true, mode: 'apply', seed: seedName, result } };
};
