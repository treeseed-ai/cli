import { formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits } from '@treeseed/sdk/seeds';
import { planReconciliation, reconcileTarget } from '@treeseed/sdk/reconcile';
import type { CommandHandler } from '../../types.js';

function environment(value: unknown) {
	const selected = typeof value === 'string' ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : ['local'];
	if (selected.length !== 1 || !['local', 'staging', 'prod'].includes(selected[0]!)) {
		throw new Error('Seed repository reconciliation requires exactly one --environments value: local, staging, or prod.');
	}
	return selected[0] as 'local' | 'staging' | 'prod';
}

function summarizedPlans(plans: Awaited<ReturnType<typeof planReconciliation>>['plans']) {
	return plans.map((plan) => ({
		unitId: plan.unit.unitId,
		repository: plan.unit.logicalName,
		action: plan.diff.action,
		reasons: plan.diff.reasons,
		exists: plan.observed.exists,
	}));
}

export const handleSeedRepositories: CommandHandler = async (invocation, context) => {
	const seedName = invocation.positionals[1];
	if (!seedName) return { exitCode: 1, stderr: ['Usage: trsd seed repositories <name> --environments <local|staging|prod> [--plan|--apply --yes]'], report: { command: 'seed repositories', ok: false, error: 'Missing seed name.' } };
	const selectedEnvironment = environment(invocation.args.environments);
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName, environment: selectedEnvironment });
	if (!compiled.ok) return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'seed repositories', ok: false, diagnostics: compiled.diagnostics } };
	const selectedProject = typeof invocation.args.project === 'string' ? invocation.args.project.trim() : '';
	const project = selectedProject ? compiled.manifest?.resources.projects.find((entry) => entry.slug === selectedProject) : null;
	const supportRepository = selectedProject ? compiled.manifest?.resources.supportRepositories.find((entry) => entry.name === selectedProject) : null;
	if (selectedProject && !project && !supportRepository) return { exitCode: 1, stderr: [`Seed ${seedName} does not declare project or support repository ${selectedProject}.`], report: { command: 'seed repositories', ok: false, error: `Unknown project or support repository ${selectedProject}.` } };
	const selectedResourceKey = project?.key ?? supportRepository?.key;
	const units = selectedResourceKey ? compiled.units.filter((unit) => unit.identity.projectId === selectedResourceKey) : compiled.units;
	const target = { kind: 'persistent' as const, scope: selectedEnvironment };
	const live = invocation.args.apply === true;
	if (live && invocation.args.yes !== true) return { exitCode: 1, stderr: ['Repository reconciliation mutates GitHub. Re-run with --apply --yes after inspecting --plan.'], report: { command: 'seed repositories', ok: false, error: 'Confirmation required. Re-run with --apply --yes after inspecting --plan.' } };
	if (live && selectedEnvironment === 'prod') return { exitCode: 2, stderr: ['Production GitHub mutation is restricted to the protected hosted reconciliation workflow.'], report: { command: 'seed repositories', ok: false, blocked: true, blocker: 'hosted-production-authority' } };
	if (!live) {
		const planned = await planReconciliation({ tenantRoot: context.cwd, target, env: context.env, units });
		const plans = summarizedPlans(planned.plans);
		return {
			exitCode: plans.some((plan) => plan.action === 'blocked') ? 2 : 0,
			stdout: context.outputFormat === 'json' ? [] : plans.map((plan) => `${plan.repository}: ${plan.action}${plan.reasons.length ? ` (${plan.reasons.join('; ')})` : ''}`),
			report: { command: 'seed repositories', ok: !plans.some((plan) => plan.action === 'blocked'), mode: 'plan', seed: seedName, project: selectedProject || null, environment: selectedEnvironment, manifestPath: compiled.manifestPath, plans },
		};
	}
	const reconciled = await reconcileTarget({ tenantRoot: context.cwd, target, env: context.env, units, write: (line) => context.write(`[seed repositories] ${line}`, 'stderr') });
	const plans = summarizedPlans(reconciled.plans);
	const ok = reconciled.results.every((result) => result.verification?.verified === true);
	return {
		exitCode: ok ? 0 : 2,
		stdout: context.outputFormat === 'json' ? [] : plans.map((plan) => `${plan.repository}: ${plan.action}`),
		report: { command: 'seed repositories', ok, mode: 'apply', seed: seedName, project: selectedProject || null, environment: selectedEnvironment, manifestPath: compiled.manifestPath, plans, results: reconciled.results.map((result) => ({ unitId: result.unit.unitId, action: result.action, verification: result.verification })) },
	};
};
