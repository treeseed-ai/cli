import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '@treeseed/sdk';
import {
	command, detail, devManagedHelpCommand, example, related, workspaceCommand,
	DEV_LOGS_OPTIONS, DEV_RUNTIME_OPTIONS, DEV_START_OPTIONS, DEV_STATUS_OPTIONS, DEV_STOP_OPTIONS,
	PASS_THROUGH_ARGS, TOOL_WRAPPER_OPTIONS, type CommandOverlay,
} from './operations-registry-support.ts';

export const CLI_COMMAND_OVERLAYS_4: Array<[string, CommandOverlay]> = [
	['build', command({ examples: ['treeseed build'], help: { longSummary: ['Build runs the tenant build path and produces the generated output for the current project.'], examples: [example('treeseed build', 'Build the tenant', 'Run the packaged build flow for the current project.'), example('trsd build', 'Use the short alias', 'Run the same build through the shorter entrypoint.'), example('treeseed build && treeseed export', 'Build before packaging context', 'Produce build artifacts first and then capture a code export if needed.')] }, executionMode: 'adapter' })],
	['check', command({ examples: ['treeseed check'], help: { longSummary: ['Check runs the project validation path against the current tenant and shared fixture model.'], examples: [example('treeseed check', 'Validate the tenant', 'Run the project check flow.'), example('trsd check', 'Use the short alias', 'Run the same validation via the short entrypoint.'), example('treeseed check && treeseed doctor', 'Pair validation with diagnostics', 'Follow failed checks with the broader doctor surface.')] }, executionMode: 'adapter' })],
	['preview', command({ examples: ['treeseed preview'], help: { longSummary: ['Preview serves the built tenant output locally so you can inspect the built site rather than the live dev runtime.'], examples: [example('treeseed preview', 'Preview the built site', 'Run the packaged preview flow for the built tenant.'), example('treeseed preview -- --help', 'Forward preview help', 'Pass through additional args when the preview runtime supports them.'), example('treeseed build && treeseed preview', 'Build then preview', 'Generate the build output first and then serve it locally.')] }, executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
	['lint', command({ examples: ['treeseed lint'], help: { longSummary: ['Lint runs the project linting and related surface checks for the current tenant.'], examples: [example('treeseed lint', 'Run lint', 'Execute the lint checks for the current project.'), example('trsd lint', 'Use the short alias', 'Run the same lint checks through the shorter entrypoint.'), example('treeseed lint && treeseed test:unit', 'Lint before unit tests', 'Use lint as a first local verification step.')] }, executionMode: 'adapter' })],
	['test', command({ examples: ['treeseed test'], help: { longSummary: ['Test runs the default Treeseed test surface for the current project.'], examples: [example('treeseed test', 'Run the default test suite', 'Execute the standard project test flow.'), example('trsd test', 'Use the short alias', 'Run the same test surface with the shorter entrypoint.'), example('treeseed test && treeseed build', 'Verify before building', 'Run tests before the build step in a local verification loop.')] }, executionMode: 'adapter' })],
	['test:unit', command({ examples: ['treeseed test:unit'], help: { longSummary: ['Test:unit runs workspace unit tests in dependency order.'], examples: [example('treeseed test:unit', 'Run unit tests', 'Execute the package unit test flow.'), example('trsd test:unit', 'Use the short alias', 'Run the same unit tests via the short entrypoint.'), example('treeseed test:unit && treeseed check', 'Unit tests then validation', 'Combine focused tests with broader tenant validation.')] }, executionMode: 'adapter' })],
	['preflight', command({
		options: [
			{ name: 'launch', flags: '--launch', description: 'Validate managed TreeSeed launch prerequisites, provider auth, and required live configuration.', kind: 'boolean' },
		],
		examples: ['treeseed preflight', 'treeseed preflight --launch'],
		help: {
			longSummary: ['Preflight checks local prerequisites and authentication state before heavier workflows run.'],
			examples: [
				example('treeseed preflight', 'Run the preflight checklist', 'Inspect local prerequisites and auth readiness.'),
				example('treeseed preflight --launch', 'Validate live launch readiness', 'Check managed TreeSeed launch prerequisites before creating live GitHub, Cloudflare, and Railway resources.'),
				example('trsd preflight', 'Use the short alias', 'Run the same readiness check via the short entrypoint.'),
				example('treeseed preflight && treeseed dev', 'Validate before starting local runtime', 'Confirm readiness before launching the integrated dev surface.'),
			],
		},
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({
			launch: invocation.args.launch === true,
		}),
	})],
	['auth:check', command({ examples: ['treeseed auth:check'], executionMode: 'adapter', buildAdapterInput: () => ({ requireAuth: true }) })],
	['test:e2e', command({ examples: ['treeseed test:e2e'], executionMode: 'adapter' })],
	['test:e2e:local', command({ examples: ['treeseed test:e2e:local'], executionMode: 'adapter' })],
	['test:e2e:staging', command({ examples: ['treeseed test:e2e:staging'], executionMode: 'adapter' })],
	['test:e2e:full', command({ examples: ['treeseed test:e2e:full'], executionMode: 'adapter' })],
	['test:release', command({ examples: ['treeseed test:release'], executionMode: 'adapter' })],
	['test:release:full', command({ examples: ['treeseed test:release:full', 'treeseed release:verify'], executionMode: 'adapter' })],
	['release:publish:changed', command({ examples: ['treeseed release:publish:changed'], executionMode: 'adapter' })],
	['astro', command({ examples: ['treeseed astro -- --help'], executionMode: 'adapter', buildAdapterInput: PASS_THROUGH_ARGS })],
	['d1:migrate:local', command({ examples: ['treeseed d1:migrate:local'], executionMode: 'adapter' })],
	['cleanup:markdown', command({
		examples: ['treeseed cleanup:markdown docs/README.md'],
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({ targets: invocation.positionals, check: false }),
	})],
	['cleanup', command({
		group: 'Workflow',
		summary: 'Prune local generated artifacts and package caches before long verification.',
		description: 'Removes Treeseed temporary/cache directories, generated scene and release evidence, npm cache, and, in aggressive mode, local Docker images and volumes.',
		provider: 'default',
		usage: 'treeseed cleanup local [--mode standard|aggressive] [--no-docker] [--no-npm-cache] [--json]',
		arguments: [{ name: 'action', description: 'Cleanup action. Use local.', required: false }],
		options: [
			{ name: 'mode', flags: '--mode <mode>', description: 'Cleanup mode.', kind: 'enum', values: ['standard', 'aggressive'] },
			{ name: 'noDocker', flags: '--no-docker', description: 'Do not run docker system prune.', kind: 'boolean' },
			{ name: 'noNpmCache', flags: '--no-npm-cache', description: 'Do not force-clear the npm cache.', kind: 'boolean' },
			{ name: 'json', flags: '--json', description: 'Emit structured JSON.', kind: 'boolean' },
		],
		examples: ['treeseed cleanup local --mode aggressive --json'],
		notes: ['Aggressive cleanup preserves Treeseed config, workflow locks, current journals, package source, and checked-in files.'],
		executionMode: 'handler',
		handlerName: 'cleanup',
	})],
	['cleanup:markdown:check', command({
		examples: ['treeseed cleanup:markdown:check docs/README.md'],
		executionMode: 'adapter',
		buildAdapterInput: (invocation) => ({ targets: invocation.positionals, check: true }),
	})],
	['starlight:patch', command({ examples: ['treeseed starlight:patch'], executionMode: 'adapter' })],
];
