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
		helpVisible: true, helpFeatured: true, executionMode: 'handler', handlerName: 'run',
	},
	{
		id: 'local.platform', name: 'platform', aliases: [], group: 'Local Development', provider: 'default', related: ['run', 'status'],
		summary: 'Inspect or stop the persistent local TreeSeed platform.', description: 'Expose status, logs, and stop diagnostics for the platform managed by trsd run.',
		usage: 'trsd platform status|logs|stop [--json]', arguments: [{ name: 'action', description: 'status, logs, or stop', required: true }],
		options: [{ name: 'json', flags: '--json', description: 'Emit structured results.', kind: 'boolean' }], examples: ['trsd platform status --json'],
		helpVisible: true, helpFeatured: false, executionMode: 'handler', handlerName: 'platform',
	},
];
