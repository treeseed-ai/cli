import {
	findTreeseedOperation as findSdkOperation,
	listTreeseedOperationNames as listSdkOperationNames,
	TRESEED_OPERATION_SPECS as SDK_OPERATION_SPECS,
} from '@treeseed/sdk/operations';
import type {
	TreeseedCommandArgumentSpec,
	TreeseedCommandOptionSpec,
	TreeseedOperationMetadata,
	TreeseedOperationSpec,
	TreeseedParsedInvocation,
} from './operations-types.ts';

type CommandOverlay = {
	usage?: string;
	arguments?: TreeseedCommandArgumentSpec[];
	options?: TreeseedCommandOptionSpec[];
	examples?: string[];
	notes?: string[];
	executionMode?: TreeseedOperationSpec['executionMode'];
	handlerName?: string;
	buildAdapterInput?: TreeseedOperationSpec['buildAdapterInput'];
};

function command(overlay: CommandOverlay): CommandOverlay {
	return overlay;
}

const PASS_THROUGH_ARGS = (invocation: TreeseedParsedInvocation) => ({ args: invocation.rawArgs });

const CLI_COMMAND_OVERLAYS = new Map<string, CommandOverlay>([
	['status', command({
		usage: 'treeseed status [--json]',
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed status', 'treeseed status --json'],
		executionMode: 'handler',
		handlerName: 'status',
	})],
	['tasks', command({
		usage: 'treeseed tasks [--json]',
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed tasks', 'treeseed tasks --json'],
		executionMode: 'handler',
		handlerName: 'tasks',
	})],
	['switch', command({
		usage: 'treeseed switch <branch-name> [--preview] [--json]',
		arguments: [{ name: 'branch-name', description: 'Task branch to create or resume.', required: true }],
		options: [
			{ name: 'preview', flags: '--preview', description: 'Provision or refresh a branch-scoped Cloudflare preview environment.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed switch feature/search-improvements', 'treeseed switch feature/search-improvements --preview'],
		executionMode: 'handler',
		handlerName: 'switch',
	})],
	['save', command({
		usage: 'treeseed save [--hotfix] [--preview] <message> [--json]',
		arguments: [{ name: 'message', description: 'Git commit message for the save operation.', required: true, kind: 'message_tail' }],
		options: [
			{ name: 'hotfix', flags: '--hotfix', description: 'Allow save on main for an explicit hotfix.', kind: 'boolean' },
			{ name: 'preview', flags: '--preview', description: 'Create or refresh the branch preview during save.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed save "feat: add search filters"', 'treeseed save --preview "feat: add search filters"', 'treeseed save --hotfix "fix: unblock production form submit"'],
		executionMode: 'handler',
		handlerName: 'save',
	})],
	['close', command({
		usage: 'treeseed close <message> [--json]',
		arguments: [{ name: 'message', description: 'Reason for closing the task without staging it.', required: true, kind: 'message_tail' }],
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed close "superseded by feature/search-v2"'],
		notes: ['Auto-saves meaningful uncommitted task-branch changes before cleanup unless disabled in the workflow API.'],
		executionMode: 'handler',
		handlerName: 'close',
	})],
	['stage', command({
		usage: 'treeseed stage <message> [--json]',
		arguments: [{ name: 'message', description: 'Resolution message for the staged task.', required: true, kind: 'message_tail' }],
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed stage "feat: add search filters"'],
		notes: ['Auto-saves meaningful uncommitted task-branch changes before merging into staging.'],
		executionMode: 'handler',
		handlerName: 'stage',
	})],
	['rollback', command({
		usage: 'treeseed rollback <staging|prod> [--to <deploy-id|commit>] [--json]',
		arguments: [{ name: 'environment', description: 'The persistent environment to roll back.', required: true }],
		options: [
			{ name: 'to', flags: '--to <deploy-id|commit>', description: 'Explicit commit to roll back to. Defaults to the previous recorded deployment when omitted.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed rollback staging', 'treeseed rollback prod --to abc1234'],
		executionMode: 'handler',
		handlerName: 'rollback',
	})],
	['doctor', command({
		usage: 'treeseed doctor [--fix] [--json]',
		options: [
			{ name: 'fix', flags: '--fix', description: 'Apply safe local repairs before rerunning diagnostics.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed doctor', 'treeseed doctor --fix --json'],
		executionMode: 'handler',
		handlerName: 'doctor',
	})],
	['auth:login', command({
		usage: 'treeseed auth:login [--host <id>] [--json]',
		options: [
			{ name: 'host', flags: '--host <id>', description: 'Override the configured remote host id for this login.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed auth:login'],
		executionMode: 'handler',
		handlerName: 'auth:login',
	})],
	['auth:logout', command({
		usage: 'treeseed auth:logout [--host <id>] [--json]',
		options: [
			{ name: 'host', flags: '--host <id>', description: 'Override the configured remote host id to clear.', kind: 'string' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed auth:logout'],
		executionMode: 'handler',
		handlerName: 'auth:logout',
	})],
	['auth:whoami', command({
		usage: 'treeseed auth:whoami [--json]',
		options: [{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' }],
		examples: ['treeseed auth:whoami'],
		executionMode: 'handler',
		handlerName: 'auth:whoami',
	})],
	['template', command({
		usage: 'treeseed template [list|show|validate] [id]',
		arguments: [
			{ name: 'action', description: 'Template action: list, show, or validate.', required: false },
			{ name: 'id', description: 'Template id for show or validate.', required: false },
		],
		examples: ['treeseed template', 'treeseed template list', 'treeseed template show starter-basic', 'treeseed template validate'],
		executionMode: 'handler',
		handlerName: 'template',
	})],
	['sync', command({
		usage: 'treeseed sync [--check]',
		options: [{ name: 'check', flags: '--check', description: 'Report managed-surface drift without changing files.', kind: 'boolean' }],
		examples: ['treeseed sync --check', 'treeseed sync'],
		executionMode: 'handler',
		handlerName: 'sync',
	})],
	['init', command({
		usage: 'treeseed init <directory> [--template <starter-id>] [--name <site-name>] [--slug <slug>] [--site-url <url>] [--contact-email <email>] [--repo <url>] [--discord <url>]',
		arguments: [{ name: 'directory', description: 'Target directory for the new tenant.', required: true }],
		options: [
			{ name: 'template', flags: '--template <starter-id>', description: 'Select the starter template id to generate. Defaults to starter-basic.', kind: 'string' },
			{ name: 'name', flags: '--name <site-name>', description: 'Override the generated site name.', kind: 'string' },
			{ name: 'slug', flags: '--slug <slug>', description: 'Override the generated package and tenant slug.', kind: 'string' },
			{ name: 'siteUrl', flags: '--site-url <url>', description: 'Set the initial public site URL.', kind: 'string' },
			{ name: 'contactEmail', flags: '--contact-email <email>', description: 'Set the site contact address.', kind: 'string' },
			{ name: 'repo', flags: '--repo <url>', description: 'Set the repository URL.', kind: 'string' },
			{ name: 'discord', flags: '--discord <url>', description: 'Set the Discord/community URL.', kind: 'string' },
		],
		examples: ['treeseed init docs-site --template starter-basic --name "Docs Site" --site-url https://docs.example.com'],
		notes: ['Runs outside an existing repo or from any branch.'],
		executionMode: 'handler',
		handlerName: 'init',
	})],
	['config', command({
		usage: 'treeseed config [--environment <all|local|staging|prod>]... [--sync <none|github|cloudflare|railway|all>] [--print-env] [--print-env-only] [--show-secrets] [--rotate-machine-key]',
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Select all environments or limit configuration to local, staging, or prod. Defaults to all.', kind: 'enum', repeatable: true, values: ['all', 'local', 'staging', 'prod'] },
			{ name: 'sync', flags: '--sync <mode>', description: 'Sync hosted secrets/variables to GitHub, Cloudflare, Railway, or all providers. Defaults to all.', kind: 'enum', values: ['none', 'github', 'cloudflare', 'railway', 'all'] },
			{ name: 'printEnv', flags: '--print-env', description: 'Print resolved environment values before remote initialization.', kind: 'boolean' },
			{ name: 'printEnvOnly', flags: '--print-env-only', description: 'Print resolved environment values, check provider connections, and exit without prompting or initializing remote resources.', kind: 'boolean' },
			{ name: 'showSecrets', flags: '--show-secrets', description: 'Print full secret values in environment reports instead of masking them.', kind: 'boolean' },
			{ name: 'rotateMachineKey', flags: '--rotate-machine-key', description: 'Regenerate the local home machine key and re-encrypt stored Treeseed secrets and remote auth sessions.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed config', 'treeseed config --environment all', 'treeseed config --environment local --sync none', 'treeseed config --environment staging --print-env-only --show-secrets', 'treeseed config --rotate-machine-key'],
		notes: ['Does not create branch preview deployments. Use `treeseed switch <branch> --preview` for that.'],
		executionMode: 'handler',
		handlerName: 'config',
	})],
	['release', command({
		usage: 'treeseed release --major|--minor|--patch',
		options: [
			{ name: 'major', flags: '--major', description: 'Bump to the next major version.', kind: 'boolean' },
			{ name: 'minor', flags: '--minor', description: 'Bump to the next minor version.', kind: 'boolean' },
			{ name: 'patch', flags: '--patch', description: 'Bump to the next patch version.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed release --patch', 'treeseed release --minor'],
		notes: ['Requires exactly one bump flag.'],
		executionMode: 'handler',
		handlerName: 'release',
	})],
	['destroy', command({
		usage: 'treeseed destroy --environment <local|staging|prod> [--dry-run] [--force] [--skip-confirmation] [--confirm <slug>] [--remove-build-artifacts]',
		options: [
			{ name: 'environment', flags: '--environment <scope>', description: 'Select the persistent environment to destroy.', kind: 'enum', values: ['local', 'staging', 'prod'] },
			{ name: 'dryRun', flags: '--dry-run', description: 'Preview the destroy operation.', kind: 'boolean' },
			{ name: 'force', flags: '--force', description: 'Force worker deletion when supported.', kind: 'boolean' },
			{ name: 'skipConfirmation', flags: '--skip-confirmation', description: 'Skip the interactive confirmation prompt.', kind: 'boolean' },
			{ name: 'confirm', flags: '--confirm <slug>', description: 'Provide the expected slug confirmation non-interactively.', kind: 'string' },
			{ name: 'removeBuildArtifacts', flags: '--remove-build-artifacts', description: 'Also remove local build artifacts after destroy.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
		],
		examples: ['treeseed destroy --environment staging --dry-run', 'treeseed destroy --environment prod --confirm example --skip-confirmation'],
		notes: ['Only for persistent environments. Task cleanup belongs to treeseed close.', 'This command is destructive and requires explicit confirmation.'],
		executionMode: 'handler',
		handlerName: 'destroy',
	})],
	['dev', command({ examples: ['treeseed dev'], executionMode: 'handler', handlerName: 'dev' })],
	['dev:watch', command({ examples: ['treeseed dev:watch'], executionMode: 'handler', handlerName: 'dev' })],
	['build', command({ examples: ['treeseed build'], executionMode: 'adapter' })],
	['check', command({ examples: ['treeseed check'], executionMode: 'adapter' })],
	['preview', command({ examples: ['treeseed preview'], executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
	['lint', command({ examples: ['treeseed lint'], executionMode: 'adapter' })],
	['test', command({ examples: ['treeseed test'], executionMode: 'adapter' })],
	['test:unit', command({ examples: ['treeseed test:unit'], executionMode: 'adapter' })],
	['preflight', command({ examples: ['treeseed preflight'], executionMode: 'adapter' })],
	['auth:check', command({ examples: ['treeseed auth:check'], executionMode: 'adapter', buildAdapterInput: () => ({ requireAuth: true }) })],
	['test:e2e', command({ examples: ['treeseed test:e2e'], executionMode: 'adapter' })],
	['test:e2e:local', command({ examples: ['treeseed test:e2e:local'], executionMode: 'adapter' })],
	['test:e2e:staging', command({ examples: ['treeseed test:e2e:staging'], executionMode: 'adapter' })],
	['test:e2e:full', command({ examples: ['treeseed test:e2e:full'], executionMode: 'adapter' })],
	['test:release', command({ examples: ['treeseed test:release'], executionMode: 'adapter' })],
	['test:release:full', command({ examples: ['treeseed test:release:full', 'treeseed release:verify'], executionMode: 'adapter' })],
	['release:publish:changed', command({ examples: ['treeseed release:publish:changed'], executionMode: 'adapter' })],
	['astro', command({ examples: ['treeseed astro -- --help'], executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
	['sync:devvars', command({ examples: ['treeseed sync:devvars'], executionMode: 'adapter' })],
	['mailpit:up', command({ examples: ['treeseed mailpit:up'], executionMode: 'adapter' })],
	['mailpit:down', command({ examples: ['treeseed mailpit:down'], executionMode: 'adapter' })],
	['mailpit:logs', command({ examples: ['treeseed mailpit:logs'], executionMode: 'adapter' })],
	['d1:migrate:local', command({ examples: ['treeseed d1:migrate:local'], executionMode: 'adapter' })],
	['cleanup:markdown', command({
		examples: ['treeseed cleanup:markdown docs/README.md'],
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({ targets: invocation.positionals, check: false }),
	})],
	['cleanup:markdown:check', command({
		examples: ['treeseed cleanup:markdown:check docs/README.md'],
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({ targets: invocation.positionals, check: true }),
	})],
	['starlight:patch', command({ examples: ['treeseed starlight:patch'], executionMode: 'adapter' })],
]);

function mergeOperationSpec(metadata: TreeseedOperationMetadata): TreeseedOperationSpec {
	const overlay = CLI_COMMAND_OVERLAYS.get(metadata.name) ?? {};
	return {
		...metadata,
		usage: overlay.usage,
		arguments: overlay.arguments,
		options: overlay.options,
		examples: overlay.examples,
		notes: overlay.notes,
		executionMode: overlay.executionMode ?? 'adapter',
		handlerName: overlay.handlerName,
		buildAdapterInput: overlay.buildAdapterInput,
	};
}

export const TRESEED_OPERATION_SPECS: TreeseedOperationSpec[] = SDK_OPERATION_SPECS.map(mergeOperationSpec);

export const TRESEED_OPERATION_INDEX = new Map<string, TreeseedOperationSpec>();
for (const spec of TRESEED_OPERATION_SPECS) {
	TRESEED_OPERATION_INDEX.set(spec.name, spec);
	for (const alias of spec.aliases) {
		TRESEED_OPERATION_INDEX.set(alias, spec);
	}
}

export function findTreeseedOperation(name: string | null | undefined) {
	if (!name) return null;
	const metadata = findSdkOperation(name);
	return metadata ? (TRESEED_OPERATION_INDEX.get(metadata.name) ?? mergeOperationSpec(metadata)) : null;
}

export function listTreeseedOperationNames() {
	return listSdkOperationNames();
}
