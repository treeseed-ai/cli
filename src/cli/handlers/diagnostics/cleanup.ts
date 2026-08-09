import { planProjectCleanup,runProjectCleanup,type LocalCleanupMode } from '@treeseed/sdk/workflow-support';
import type { CommandHandler } from '../../types.js';

function cleanupMode(value: unknown): LocalCleanupMode {
	return value === 'standard' ? 'standard' : 'aggressive';
}

function formatBytes(bytes: number) {
	if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
	if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
	if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${bytes} B`;
}

export const handleCleanup: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'local';
	if (action !== 'local') {
		return {
			exitCode: 1,
			stdout: [],
			stderr: [`Unsupported cleanup action "${action}". Use local.`],
			report: { command: 'cleanup', ok: false, error: `Unsupported action: ${action}` },
		};
	}
	const mode = cleanupMode(invocation.args.mode);
	const plan = invocation.args.plan === true;
	if (!plan && invocation.args.yes !== true) {
		return {
			exitCode: 1,
			stdout: [],
			stderr: ['Local cleanup deletes generated project data. Inspect --plan, then re-run with --yes.'],
			report: { command: 'cleanup local', ok: false, error: 'Confirmation required.' },
		};
	}
	const report = plan
		? planProjectCleanup({ root: context.cwd, mode })
		: runProjectCleanup({ root: context.cwd, mode });
	return {
		exitCode: report.ok ? 0 : 1,
		stdout: [
			report.ok
				? `Treeseed local cleanup ${plan ? 'plan ready' : 'completed'}.`
				: `Treeseed local cleanup ${plan ? 'plan' : 'execution'} is blocked.`,
			`Mode: ${report.mode}`,
			`${plan ? 'Reclaimable' : 'Reclaimed'}: ${formatBytes(plan ? report.beforeBytes : report.reclaimedBytes)}`,
			`Actions: ${report.actions.filter((entry) => entry.status === 'planned').length} planned, ${report.actions.filter((entry) => entry.status === 'removed').length} removed, ${report.actions.filter((entry) => entry.status === 'skipped').length} skipped, ${report.actions.filter((entry) => entry.status === 'blocked').length} blocked, ${report.actions.filter((entry) => entry.status === 'failed').length} failed`,
		],
		stderr: report.actions.filter((entry) => entry.status === 'failed' || entry.status === 'blocked').map((entry) => `${entry.id}: ${entry.error ?? entry.status}`),
		report: { command: 'cleanup local', ...report },
	};
};
