import { planProjectCleanup, runProjectCleanup, type LocalCleanupMode } from '@treeseed/sdk/workflow-support';
import type { CommandHandler, ParsedInvocation } from '../../types.js';
import { handlePlatform } from '../runtime/run.js';

function cleanupMode(value: unknown, fallback: LocalCleanupMode): LocalCleanupMode {
	return value === 'standard' || value === 'aggressive' ? value : fallback;
}

function formatBytes(bytes: number) {
	if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
	if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
	if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${bytes} B`;
}

function platformInvocation(source: ParsedInvocation, plan: boolean): ParsedInvocation {
	return { commandName: 'platform', rawArgs: source.rawArgs, positionals: ['stop'], args: { json: true, ...(plan ? { plan: true } : {}) } };
}

async function handleProjectCleanup(invocation: ParsedInvocation, context: Parameters<CommandHandler>[1]) {
	const mode = cleanupMode(invocation.args.mode, 'standard');
	const plan = planProjectCleanup({ root: context.cwd, mode });
	if (!plan.ok) return {
		exitCode: 1,
		stdout: [`Project cleanup is blocked by ${plan.blockers.length} recent unfinished scene run${plan.blockers.length === 1 ? '' : 's'}.`],
		stderr: plan.blockers.map((path) => `Active scene: ${path}`),
		report: { command: 'clean project', ...plan },
	};
	if (invocation.args.plan === true) {
		const services = await handlePlatform(platformInvocation(invocation, true), context);
		const servicesOk = (services.exitCode ?? 0) === 0;
		return {
			exitCode: servicesOk ? 0 : 1,
			stdout: [`Project cleanup plan: ${formatBytes(plan.beforeBytes)} reclaimable across ${plan.actions.filter((entry) => entry.status === 'planned').length} paths.`],
			stderr: services.stderr ?? [],
			report: { command: 'clean project', ...plan, ok: plan.ok && servicesOk, services: services.report ?? null },
		};
	}
	if (invocation.args.yes !== true) {
		const confirmed = context.confirm
			? await context.confirm(`Stop services for this worktree and remove ${formatBytes(plan.beforeBytes)} of generated project data?`, 'yes')
			: false;
		if (!confirmed) return {
			exitCode: 1,
			stderr: ['Project cleanup requires confirmation. Re-run with --yes or use --plan first.'],
			report: { command: 'clean project', ok: false, error: 'Confirmation required.', plan },
		};
	}
	const services = await handlePlatform(platformInvocation(invocation, false), context);
	if ((services.exitCode ?? 0) !== 0) return {
		exitCode: 1,
		stdout: ['Project data was preserved because scoped service shutdown failed.'],
		stderr: services.stderr ?? ['Current-worktree service shutdown failed.'],
		report: { command: 'clean project', ok: false, error: 'Service shutdown failed.', plan, services: services.report ?? null },
	};
	const report = runProjectCleanup({ root: context.cwd, mode });
	return {
		exitCode: report.ok ? 0 : 1,
		stdout: [
			report.ok ? 'Treeseed project cleanup completed.' : 'Treeseed project cleanup completed with failures.',
			`Mode: ${report.mode}`,
			`Reclaimed: ${formatBytes(report.reclaimedBytes)}`,
			`Actions: ${report.actions.filter((entry) => entry.status === 'removed').length} removed, ${report.actions.filter((entry) => entry.status === 'skipped').length} skipped, ${report.actions.filter((entry) => entry.status === 'failed').length} failed`,
		],
		stderr: report.actions.filter((entry) => entry.status === 'failed').map((entry) => `${entry.id}: ${entry.error ?? 'failed'}`),
		report: { command: 'clean project', ...report, services: services.report ?? null },
	};
}

export const handleClean: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'project';
	if (action === 'project') return handleProjectCleanup(invocation, context);
	return {
		exitCode: 1,
		stdout: [],
		stderr: [`Unsupported clean scope "${action}". Use project or omit the scope.`],
		report: { command: 'clean', ok: false, error: `Unsupported scope: ${action}` },
	};
};
