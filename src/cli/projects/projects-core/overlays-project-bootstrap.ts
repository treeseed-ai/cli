import { DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from '../../operations/operations-registry-support.ts';

export const projectBootstrapCommandOverlays: Array<[string, CommandOverlay]> = [
	['template', command({
			usage: 'treeseed template [list|show|validate] [id]',
			arguments: [
				{ name: 'action', description: 'Template action: list, show, or validate.', required: false },
				{ name: 'id', description: 'Template id for show or validate.', required: false },
			],
			options: [
				{ name: 'market', flags: '--market <id-or-url>', description: 'Select a configured market id or direct API URL.', kind: 'string' },
				{ name: 'version', flags: '--version <version>', description: 'Artifact version for market template install.', kind: 'string' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: ['treeseed template', 'treeseed template list', `treeseed template show ${DEFAULT_STARTER_TEMPLATE_ID}`, 'treeseed template validate'],
			help: {
				longSummary: [
						'Template exposes local starter catalog actions and market-backed search/install actions. Market search/install uses an integrated catalog from central and configured specialized markets, with every result labeled by source market.',
				],
				examples: [
					example('treeseed template', 'Default to the catalog list', 'Show the available starters without specifying an action.'),
					example(`treeseed template show ${DEFAULT_STARTER_TEMPLATE_ID}`, 'Inspect a single starter', 'View the details of one starter template.'),
					example('treeseed template validate', 'Validate the current template set', 'Run template validation to confirm the catalog is internally consistent.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'template',
		})],
	['sync', command({
			options: [{ name: 'check', flags: '--check', description: 'Report managed-surface drift without changing files.', kind: 'boolean' }],
			examples: ['treeseed sync --check', 'treeseed sync'],
			help: {
				longSummary: [
					'Sync reconciles the managed template surface for the current site. It is the command to use when you want to check or restore generated/managed Treeseed surfaces.',
				],
				examples: [
					example('treeseed sync --check', 'Detect managed-surface drift', 'Report what would change without mutating files.'),
					example('treeseed sync', 'Apply managed-surface reconciliation', 'Bring managed surfaces back into sync with the current template model.'),
					example('trsd sync --check', 'Use the short alias', 'Run the same sync drift check through the short CLI entrypoint.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'sync',
		})],
	['init', command({
			arguments: [{ name: 'directory', description: 'Target directory for the new tenant.', required: true }],
			options: [
				{ name: 'template', flags: '--template <starter-id>', description: `Select the starter template id to generate. Defaults to ${DEFAULT_STARTER_TEMPLATE_ID}.`, kind: 'string' },
				{ name: 'name', flags: '--name <site-name>', description: 'Override the generated site name.', kind: 'string' },
				{ name: 'slug', flags: '--slug <slug>', description: 'Override the generated package and tenant slug.', kind: 'string' },
				{ name: 'siteUrl', flags: '--site-url <url>', description: 'Set the initial public site URL.', kind: 'string' },
				{ name: 'contactEmail', flags: '--contact-email <email>', description: 'Set the site contact address.', kind: 'string' },
				{ name: 'repo', flags: '--repo <url>', description: 'Set the repository URL.', kind: 'string' },
				{ name: 'discord', flags: '--discord <url>', description: 'Set the Discord/community URL.', kind: 'string' },
				{ name: 'host', flags: '--host <requirement=provider:alias>', description: 'Bind a template launch requirement locally. Repeat for multiple requirements, or use requirement=none for optional hosts.', kind: 'string', repeatable: true },
			],
			examples: [
				`treeseed init docs-site --template ${DEFAULT_STARTER_TEMPLATE_ID} --name "Docs Site" --site-url https://docs.example.com`,
				`treeseed init docs-site --template ${DEFAULT_STARTER_TEMPLATE_ID} --host sourceRepository=github:acme --host publicWeb=cloudflare:managed`,
			],
			notes: ['Runs outside an existing repo or from any branch.'],
			help: {
				workflowPosition: 'create workspace',
				longSummary: [
					'Init scaffolds a new Treeseed tenant from the starter catalog. It is the entry point for creating a new project directory with the expected manifest, content layout, and runtime scaffolding.',
				],
				whenToUse: [
					'Use this when creating a brand-new Treeseed tenant.',
					'Use it outside an existing repo or from any branch because initialization targets a directory rather than the current branch lifecycle.',
				],
				beforeYouRun: [
					'Choose the target directory and starter template before running the command.',
					'Decide which identity fields you want to override at scaffold time, such as site name, slug, and public URL.',
				],
				outcomes: [
					'Creates the requested tenant directory and starter structure.',
					'Seeds the project metadata fields requested through the CLI flags.',
				],
				examples: [
					example(`treeseed init docs-site --template ${DEFAULT_STARTER_TEMPLATE_ID} --name "Docs Site" --site-url https://docs.example.com`, 'Create a starter site', 'Scaffold a new tenant using the default starter and explicit branding metadata.'),
					example(`treeseed init docs-site --template ${DEFAULT_STARTER_TEMPLATE_ID} --host sourceRepository=github:acme --host publicWeb=cloudflare:managed`, 'Bind launch hosts locally', 'Apply host-derived starter config during scaffold without calling Market inventory APIs.'),
					example('treeseed init workbench --slug workbench --contact-email ops@example.com', 'Control project identity fields', 'Initialize a tenant while overriding slug and contact metadata at creation time.'),
					example('treeseed init docs-site --repo https://github.com/example/docs-site --discord https://discord.gg/example', 'Seed community and repository metadata', 'Attach repository and community URLs during project initialization.'),
				],
				relatedDetails: [
					related('config', 'Run `config` after init to set up environment variables, auth, and provider sync.'),
					related('dev', 'Run `dev` after init when you are ready to start the integrated local runtime.'),
				],
			},
			executionMode: 'handler',
			handlerName: 'init',
		})],
];
