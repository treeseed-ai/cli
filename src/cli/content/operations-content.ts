import type { OperationSpec } from '../operations/operations-types.ts';

export const contentOperationSpecs: OperationSpec[] = [{
	id: 'content.sync',
	name: 'content',
	aliases: [],
	group: 'Utilities',
	summary: 'Plan or safely fast-forward repository-native content across local Git, TreeDX, and upstream Git.',
	description: 'Compares exact publication commits and refuses dirty, stale, detached, missing, or diverged repositories.',
	provider: 'default',
	related: ['db', 'save', 'projects'],
	usage: 'treeseed content sync --project <project-id> [--branch <ref>] [--path <checkout>] [--plan] [--json]',
	arguments: [{ name: 'action', description: 'Content action; currently sync.', required: false }],
	options: [
		{ name: 'market', flags: '--market <id-or-url>', description: 'Configured Market profile or API URL.', kind: 'string' },
		{ name: 'project', flags: '--project <project-id>', description: 'Project whose bound TreeDX repository is compared.', kind: 'string' },
		{ name: 'branch', flags: '--branch <ref>', description: 'Publication branch to compare; defaults to staging.', kind: 'string' },
		{ name: 'path', flags: '--path <checkout>', description: 'Local Git checkout; defaults to the current directory.', kind: 'string' },
		{ name: 'plan', flags: '--plan', description: 'Inspect exact refs without changing the checkout.', kind: 'boolean' },
		{ name: 'json', flags: '--json', description: 'Emit machine-readable output.', kind: 'boolean' },
	],
	examples: [
		'treeseed content sync --project project_123 --branch staging --plan --json',
		'treeseed content sync --project project_123 --branch staging',
	],
	notes: [
		'Live sync fetches and fast-forwards only after local, upstream, and TreeDX commits match the plan.',
		'Dirty, detached, missing, stale, or diverged repositories fail closed and no local work is discarded.',
	],
	help: {
		longSummary: ['Content sync compares exact local, TreeDX, and upstream Git revisions before any repository-native content movement.'],
		whenToUse: ['Use plan mode to diagnose publication-ref drift, then use live sync only when the local checkout can safely fast-forward.'],
		beforeYouRun: ['Select the bound project and ensure the local checkout has no uncommitted changes or detached branch state.'],
		automationNotes: ['The command fails closed on stale, missing, dirty, detached, or diverged state and never discards local work.'],
	},
	helpVisible: true,
	helpFeatured: false,
	executionMode: 'handler',
	handlerName: 'content',
}];
