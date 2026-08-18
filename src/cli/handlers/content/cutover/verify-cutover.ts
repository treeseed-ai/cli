import { reconcileTarget } from '@treeseed/sdk';
import { compileDesiredResourceGraph, compileDesiredUnitsFromGraph } from '@treeseed/sdk/platform/desired-state';
import { formatSeedDiagnostics, loadAndCompileSeedRepositoryUnits, planContentCutover, recordContentCutover, removeVerifiedSoftwareContent } from '@treeseed/sdk/seeds';
import { collectConfigSeedValues } from '@treeseed/sdk/workflow-support';
import type { CommandContext, CommandResult, ParsedInvocation } from '../../../types.js';
import { fail } from '../../utilities/utils.js';

function textArg(invocation: ParsedInvocation, key: string) {
	const value = invocation.args[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function handleContentCutover(invocation: ParsedInvocation, context: CommandContext): Promise<CommandResult> {
	const seed = textArg(invocation, 'seed');
	const project = textArg(invocation, 'project');
	const branch = textArg(invocation, 'branch') ?? 'staging';
	const planOnly = invocation.args.plan === true;
	const apply = invocation.args.apply === true;
	if (!seed || !project) return fail('Content cutover requires --seed <name> and --project <slug>.');
	if (planOnly === apply) return fail('Select exactly one of --plan or --apply.');
	if (apply && invocation.args.yes !== true) return fail('Content cutover verification requires --apply --yes after inspecting --plan.');
	if (branch !== 'staging') return fail('The initial software-content cutover gate is limited to staging.');
	const compiled = loadAndCompileSeedRepositoryUnits({ projectRoot: context.cwd, seedName: seed, environment: 'local' });
	if (!compiled.ok || !compiled.manifest) {
		return { exitCode: 1, stderr: formatSeedDiagnostics(compiled.diagnostics), report: { command: 'content cutover', ok: false, diagnostics: compiled.diagnostics } };
	}
	const target = { kind: 'persistent' as const, scope: 'local' as const };
	const selector = { provider: ['local'], unitType: ['local-treedx'] };
	const graph = compileDesiredResourceGraph({ tenantRoot: context.cwd, target });
	const units = compileDesiredUnitsFromGraph(graph, selector)
		.filter((unit) => unit.unitType === 'local-treedx')
		.map((unit) => ({ ...unit, dependencies: [] }));
	if (units.length !== 1) throw new Error(`Expected one local TreeDX reconciliation unit, found ${units.length}.`);
	const environment = { ...context.env, ...collectConfigSeedValues(context.cwd, 'local', context.env) };
	const treeDx = await reconcileTarget({
		tenantRoot: context.cwd,
		target,
		env: environment,
		units,
		planOnly,
		write: (line) => context.write(`[content cutover] ${line}`, 'stderr'),
	});
	const result = treeDx.results.find((entry) => entry.unit.unitType === 'local-treedx');
	const state = result?.state && typeof result.state === 'object' ? result.state as Record<string, unknown> : {};
	const observations = Array.isArray(state.repositoryObservations) ? state.repositoryObservations : [];
	const observation = observations.find((entry) => entry && typeof entry === 'object' && (entry as { project?: unknown }).project === project) as { localHead?: unknown } | undefined;
	const treeDxObservedRef = typeof observation?.localHead === 'string' ? observation.localHead : null;
	const cutover = await planContentCutover({
		projectRoot: context.cwd,
		manifest: compiled.manifest,
		seed,
		project,
		branch,
		env: environment,
		treeDxVerification: result?.verification ?? null,
		treeDxObservedRef,
	});
	const journalPath = apply ? recordContentCutover(context.cwd, cutover) : null;
	const removalRequested = invocation.args.removeSoftwareContent === true || invocation.args['remove-software-content'] === true;
	const removal = apply && removalRequested
		? await removeVerifiedSoftwareContent({ projectRoot: context.cwd, manifest: compiled.manifest, plan: cutover })
		: null;
	const report = {
		command: 'content cutover',
		ok: planOnly || cutover.status === 'ready',
		mode: planOnly ? 'plan' : 'apply',
		cutover,
		treeDxAction: result?.action ?? treeDx.plans.find((entry) => entry.unit.unitType === 'local-treedx')?.diff.action ?? null,
		journalPath,
		removal,
	};
	return {
		exitCode: report.ok ? 0 : 1,
		stdout: context.outputFormat === 'json' || invocation.args.json === true
			? [JSON.stringify(report, null, 2)]
			: [planOnly ? `Content cutover plan for ${project}: ${cutover.status}.` : `Verified content cutover for ${project}.`],
		stderr: [],
		report,
	};
}
