import { runWorkspaceCleanup, type LocalCleanupMode } from '@treeseed/sdk/workflow-support';
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
	const report = runWorkspaceCleanup({
		root: context.cwd,
		mode,
		docker: invocation.args.noDocker !== true && mode === 'aggressive',
		npmCache: invocation.args.noNpmCache === true ? false : undefined,
	});
	return {
		exitCode: report.ok ? 0 : 1,
		stdout: [
			report.ok ? 'Treeseed local cleanup completed.' : 'Treeseed local cleanup completed with failures.',
			`Mode: ${report.mode}`,
			`Reclaimed: ${formatBytes(report.reclaimedBytes)}`,
			`Actions: ${report.actions.filter((entry) => entry.status === 'removed').length} removed, ${report.actions.filter((entry) => entry.status === 'skipped').length} skipped, ${report.actions.filter((entry) => entry.status === 'failed').length} failed`,
		],
		stderr: report.actions.filter((entry) => entry.status === 'failed').map((entry) => `${entry.id}: ${entry.error ?? 'failed'}`),
		report: { command: 'cleanup local', ...report },
	};
};
