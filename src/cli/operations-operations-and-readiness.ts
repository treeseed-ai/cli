import type { TreeseedOperationSpec } from './operations-types.ts';
import {
	devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS,
} from './operations-registry-support.ts';

export const operationsAndReadinessOperationSpecs: TreeseedOperationSpec[] = [
	{
			id: 'ready',
			name: 'ready',
			aliases: [],
			group: 'Workflow',
			summary: 'Check whether an environment is ready for staging or release.',
			description: 'Runs deployment graph readiness, hosted service checks, and Treeseed operations runner smoke diagnostics before expensive workflow promotion.',
			provider: 'default',
			related: ['hosting', 'stage', 'release', 'doctor'],
			usage: 'treeseed ready <local|staging|prod> [--live] [--strict] [--json]',
			arguments: [{ name: 'environment', description: 'Environment to check.', required: false }],
			options: [
				{ name: 'environment', flags: '--environment <scope>', description: 'Environment to check.', kind: 'enum', values: ['local', 'staging', 'prod'] },
				{ name: 'live', flags: '--live', description: 'Include live provider and HTTP checks.', kind: 'boolean' },
				{ name: 'strict', flags: '--strict', description: 'Fail when required live observations are unavailable.', kind: 'boolean' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
			],
			examples: [
				'treeseed ready staging --json',
				'treeseed ready prod --json',
			],
			help: {
				longSummary: ['Ready is the fail-fast preflight for stage and release. It checks the effective hosting graph, provider state, HTTP health, and runner operation processing before a workflow spends time on deploys.'],
				whenToUse: ['Run before stage or release, especially after hosting config or package boundary changes.'],
				beforeYouRun: ['Run from the Treeseed workspace. Use `ready local` for static local checks, and use staging or prod only when provider credentials are available for live checks.'],
				automationNotes: ['Use --json for stable readiness output. Staging and prod default to live strict checks.'],
			},
			helpVisible: true,
			helpFeatured: true,
			executionMode: 'handler',
			handlerName: 'ready',
		},
	{
			id: 'operations',
			name: 'operations',
			aliases: [],
			group: 'Utilities',
			summary: 'Run Treeseed operation-runner diagnostics.',
			description: 'Queues a diagnostic Market platform operation and verifies that the deployed operations runner claims and completes it.',
			provider: 'default',
			related: ['hosting', 'ready', 'stage'],
				usage: 'treeseed operations smoke [--environment local|staging|prod] [--service operationsRunner] [--json]',
			arguments: [{ name: 'action', description: 'Operations action.', required: false }],
			options: [
					{ name: 'environment', flags: '--environment <scope>', description: 'Environment to smoke test.', kind: 'enum', values: ['local', 'staging', 'prod'] },
				{ name: 'service', flags: '--service <service-id>', description: 'Service to smoke test. Currently operationsRunner.', kind: 'string' },
				{ name: 'json', flags: '--json', description: 'Emit machine-readable JSON instead of human-readable text.', kind: 'boolean' },
				],
				examples: [
					'treeseed operations smoke --environment local --service operationsRunner --json',
					'treeseed operations smoke --environment staging --service operationsRunner --json',
				],
				help: {
					longSummary: ['Operations smoke proves that the API, database, and operations runner work together before TreeDX/bootstrap workflows queue real work.'],
					whenToUse: ['Run when local or hosted operations stay queued, or before release resource verification.'],
					beforeYouRun: ['For local, start managed dev with `treeseed dev start --web-runtime local`. For hosted environments, run after the API and operations runner are deployed and configured through Treeseed config.'],
					automationNotes: ['The JSON report redacts credentials and includes operation id, final status, runner id, timings, and failure remediation.'],
				},
			helpVisible: true,
			helpFeatured: true,
			executionMode: 'handler',
			handlerName: 'operations',
		},
];
