import { applyGatewayContractMigration, formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planGatewayContractMigration } from '@treeseed/sdk/seeds';
import type { CommandHandler } from '../../../types.js';

export const handleSeedGatewayContracts: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	if (!seedName) return { exitCode: 1, stderr: ['Usage: trsd seed gateway-contracts <name> [--plan|--apply --yes]'], report: { command: 'seed gateway-contracts', ok: false, error: 'Seed name is required.' } };
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: 'staging' });
	if (!compiled.ok || !compiled.manifest) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed gateway-contracts', ok: false, diagnostics: compiled.diagnostics } };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Gateway contract migration pushes a scoped SDK staging commit. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed gateway-contracts', ok: false, error: 'Confirmation required.' } };
	const operation = live ? applyGatewayContractMigration : planGatewayContractMigration;
	const result = await operation({ projectRoot: context.cwd, manifest: compiled.manifest, env: context.env });
	return { exitCode: 0, stdout: context.outputFormat === 'json' ? [] : [`staging: ${result.action} (${result.reason})`], stderr: [], report: { command: 'seed gateway-contracts', ok: true, mode: live ? 'apply' : 'plan', seed: seedName, result } };
};
