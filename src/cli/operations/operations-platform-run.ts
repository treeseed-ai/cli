import type { OperationSpec } from './operations-types.ts';

export const platformRunOperationSpecs: OperationSpec[] = [
	{
		id: 'local.run', name: 'run', aliases: [], group: 'Local Development', provider: 'default', related: ['config', 'platform', 'status'],
		summary: 'Converge and start the persistent local TreeSeed platform from an exact seed set.',
		description: 'Validate an exact desired seed set, configure the project when needed, reconcile the full local platform, apply seeds, verify readiness, and persist the selected set.',
		usage: 'trsd run [seed...] [--plan] [--yes] [--foreground] [--json]',
		arguments: [{ name: 'seeds', description: 'Exact desired seed names. Omit to reuse the persisted set.', required: false }],
		options: [
			{ name: 'plan', flags: '--plan', description: 'Preview seed composition and lifecycle changes without mutation.', kind: 'boolean' },
			{ name: 'yes', flags: '--yes', description: 'Confirm destructive effects from removing active seeds.', kind: 'boolean' },
			{ name: 'foreground', flags: '--foreground', description: 'Attach to the platform lifecycle instead of returning after readiness.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit structured results.', kind: 'boolean' },
		],
		examples: ['trsd run treeseed', 'trsd run treeseed another-seed --plan --json'],
		help: {
			workflowPosition: 'reconcile local platform',
			longSummary: [
				'Run owns exact-seed convergence for the persistent local platform. It validates the desired seed set, reconciles platform infrastructure, applies seed content, and verifies readiness before persisting the selection.',
			],
			whenToUse: [
				'Use this when starting or changing the durable local platform and its exact seed set. Use `dev` for the foreground hot-reloading application runtime.',
			],
			beforeYouRun: [
				'Run from the integrated Treeseed workspace and inspect `--plan` before removing an active seed or changing persistent local resources.',
			],
			outcomes: [
				'Reconciles the local platform to the requested seed set and records the verified selection for later runs.',
			],
			automationNotes: [
				'Use `--plan --json` for a non-mutating preview. Live destructive seed removals require explicit `--yes` confirmation.',
			],
			warnings: [
				'The requested seeds are exact desired state; omitting a currently active seed may remove its managed resources or content.',
			],
		},
		helpVisible: true, helpFeatured: true, executionMode: 'handler', handlerName: 'run',
	},
	{
		id: 'local.platform', name: 'platform', aliases: [], group: 'Local Development', provider: 'default', related: ['run', 'status'],
		summary: 'Inspect or stop the persistent local TreeSeed platform.', description: 'Expose status, logs, and stop diagnostics for the platform managed by trsd run.',
		usage: 'trsd platform status|logs|stop [--json]', arguments: [{ name: 'action', description: 'status, logs, or stop', required: true }],
		options: [{ name: 'json', flags: '--json', description: 'Emit structured results.', kind: 'boolean' }], examples: ['trsd platform status --json'],
		help: {
			workflowPosition: 'inspect local platform',
			longSummary: [
				'Platform exposes status, logs, and stop controls for the persistent local platform supervised by `trsd run`.',
			],
			whenToUse: [
				'Use this to inspect or stop a previously reconciled local platform without changing its exact persisted seed selection.',
			],
			beforeYouRun: [
				'Run from the workspace that owns the local platform state and choose one action: status, logs, or stop.',
			],
			outcomes: [
				'Returns supervisor state or stops the persistent local platform while preserving the desired seed record.',
			],
			automationNotes: [
				'Use `--json` for stable supervisor records in scripts and diagnostics.',
			],
			warnings: [
				'`platform stop` stops local runtime processes; it does not destroy reconciled resources or clear the selected seeds.',
			],
		},
		helpVisible: true, helpFeatured: false, executionMode: 'handler', handlerName: 'platform',
	},
];
