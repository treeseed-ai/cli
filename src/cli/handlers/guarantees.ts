import {
	auditTreeseedGuaranteeJourneys,
	createTreeseedGuaranteeStatusReport,
	discoverTreeseedGuarantees,
	exportTreeseedGuaranteesCsv,
	exportTreeseedGuaranteesJson,
	exportTreeseedGuaranteesMarkdown,
	normalizeTreeseedGuaranteeTaxonomy,
	planTreeseedGuarantees,
	runTreeseedGuarantees,
	writeTreeseedGuaranteesExport,
	type TreeseedGuaranteeFilter,
	type TreeseedGuaranteeGate,
	type TreeseedGuaranteeStatus,
} from '@treeseed/sdk/guarantees';
import { runTreeseedManagedDev } from '@treeseed/sdk';
import { collectTreeseedConfigSeedValues } from '@treeseed/sdk/workflow-support';
import type { TreeseedCommandHandler } from '../operations-types.ts';
import { spawnSync } from 'node:child_process';

const VALID_FORMATS = new Set(['csv', 'json', 'markdown']);
const VALID_GATES = new Set(['smoke', 'core', 'release', 'security', 'migration', 'demo', 'backlog', 'future']);
const VALID_STATUSES = new Set(['active', 'planned', 'blocked', 'backlog', 'deprecated']);
const TAXONOMY_PATTERN = /^[a-z][a-z0-9-]*$/u;

function splitOption(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const values = value.flatMap((entry) => String(entry).split(',').map((part) => part.trim()).filter(Boolean));
		return values.length > 0 ? values : undefined;
	}
	if (typeof value !== 'string' || !value.trim()) return undefined;
	const values = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function integerOptions(value: unknown): number[] | undefined {
	const values = splitOption(value)?.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry));
	return values && values.length > 0 ? values : undefined;
}

function filterFromArgs(args: Record<string, string | string[] | boolean | undefined>) {
	const diagnostics: string[] = [];
	const filter: TreeseedGuaranteeFilter = {};
	for (const field of ['type', 'subtype'] as const) {
		const value = typeof args[field] === 'string' ? args[field].trim() : '';
		if (!value) continue;
		if (!TAXONOMY_PATTERN.test(value)) diagnostics.push(`--${field} must be lowercase kebab-case. Try "${normalizeTreeseedGuaranteeTaxonomy(value)}".`);
		filter[field] = value;
	}
	const gate = typeof args.gate === 'string' ? args.gate.trim() : '';
	if (gate) {
		if (!VALID_GATES.has(gate)) diagnostics.push(`Unsupported --gate value: ${gate}.`);
		filter.gate = gate as TreeseedGuaranteeGate;
	}
	const status = typeof args.status === 'string' ? args.status.trim() : '';
	if (status) {
		if (!VALID_STATUSES.has(status)) diagnostics.push(`Unsupported --status value: ${status}.`);
		filter.status = status as TreeseedGuaranteeStatus;
	}
	if (typeof args.ownerPackage === 'string' && args.ownerPackage.trim()) filter.ownerPackage = args.ownerPackage.trim();
	const ids = splitOption(args.id);
	if (ids) filter.ids = ids;
	const journeyIndexes = integerOptions(args.journeyIndex);
	if (journeyIndexes) filter.journeyIndexes = journeyIndexes;
	return { filter, diagnostics };
}

function humanDiagnostics(diagnostics: Array<{ severity: string; code: string; message: string; sourcePath?: string }>) {
	return diagnostics.map((entry) => `${entry.severity.toUpperCase()} ${entry.code}: ${entry.message}${entry.sourcePath ? ` (${entry.sourcePath})` : ''}`);
}

function normalizeVariableList(payload: unknown): Record<string, string> {
	if (Array.isArray(payload)) {
		const out: Record<string, string> = {};
		for (const entry of payload) {
			if (!entry || typeof entry !== 'object') continue;
			const record = entry as Record<string, unknown>;
			const key = typeof record.name === 'string' ? record.name : typeof record.key === 'string' ? record.key : '';
			const value = typeof record.value === 'string' ? record.value : '';
			if (key && value) out[key] = value;
		}
		return out;
	}
	if (!payload || typeof payload !== 'object') return {};
	return Object.fromEntries(Object.entries(payload as Record<string, unknown>)
		.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}

function loadApiAcceptanceServiceEnv(environment: string) {
	if (environment !== 'staging' && environment !== 'prod') return { loaded: false, diagnostics: [] as string[] };
	if (process.env.TREESEED_GUARANTEE_ENV_DISCOVERY === '1') return { loaded: false, diagnostics: [] as string[] };
	if (process.env.TREESEED_ACCEPTANCE_SERVICE_ID && process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET) return { loaded: true, diagnostics: [] as string[] };
	const configured = collectTreeseedConfigSeedValues(process.cwd(), environment, process.env);
	for (const key of ['TREESEED_ACCEPTANCE_SERVICE_ID', 'TREESEED_ACCEPTANCE_SERVICE_SECRET', 'TREESEED_WEB_SERVICE_ID', 'TREESEED_API_WEB_SERVICE_ID', 'TREESEED_WEB_SERVICE_SECRET', 'TREESEED_API_WEB_SERVICE_SECRET']) {
		if (!process.env[key] && configured[key]) process.env[key] = configured[key];
	}
	if (!process.env.TREESEED_ACCEPTANCE_SERVICE_ID) {
		process.env.TREESEED_ACCEPTANCE_SERVICE_ID = configured.TREESEED_API_WEB_SERVICE_ID || configured.TREESEED_WEB_SERVICE_ID;
	}
	if (!process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET) {
		process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET = configured.TREESEED_API_WEB_SERVICE_SECRET || configured.TREESEED_WEB_SERVICE_SECRET;
	}
	if (process.env.TREESEED_ACCEPTANCE_SERVICE_ID && process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET) return { loaded: true, diagnostics: [] as string[] };
	const cliPath = process.argv[1];
	if (!cliPath) return { loaded: false, diagnostics: ['Treeseed CLI path is unavailable for API acceptance credential discovery.'] };
	const result = spawnSync(process.execPath, [
		cliPath,
		'railway',
		'--environment',
		environment,
		'--',
		'variable',
		'list',
		'--service',
		'treeseed-api',
		'--json',
	], {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: { ...process.env, TREESEED_GUARANTEE_ENV_DISCOVERY: '1' },
		maxBuffer: 1024 * 1024 * 8,
	});
	if ((result.status ?? 1) !== 0 || !result.stdout.trim()) {
		return { loaded: false, diagnostics: [`Could not load ${environment} API service variables for acceptance guarantees.`] };
	}
	try {
		const variables = normalizeVariableList(JSON.parse(result.stdout));
		const id = variables.TREESEED_ACCEPTANCE_SERVICE_ID || variables.TREESEED_API_WEB_SERVICE_ID || variables.TREESEED_WEB_SERVICE_ID;
		const secret = variables.TREESEED_ACCEPTANCE_SERVICE_SECRET || variables.TREESEED_API_WEB_SERVICE_SECRET || variables.TREESEED_WEB_SERVICE_SECRET;
		if (!process.env.TREESEED_ACCEPTANCE_SERVICE_ID && id) process.env.TREESEED_ACCEPTANCE_SERVICE_ID = id;
		if (!process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET && secret) process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET = secret;
		return {
			loaded: Boolean(process.env.TREESEED_ACCEPTANCE_SERVICE_ID && process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET),
			diagnostics: [] as string[],
		};
	} catch {
		return { loaded: false, diagnostics: [`${environment} API service variables were not valid JSON.`] };
	}
}

export type AgentGuaranteeExecutionProviderMode = 'mock' | 'live-codex' | 'auto';

function codexAuthAvailable(env: NodeJS.ProcessEnv) {
	const explicit = env.TREESEED_CODEX_AUTH_FILE || env.CODEX_AUTH_FILE;
	if (explicit?.trim()) return true;
	const home = env.HOME || process.env.HOME;
	if (!home) return false;
	return spawnSync('test', ['-f', `${home}/.codex/auth.json`]).status === 0;
}

function resolveAgentGuaranteeExecutionProviderMode(input: { environment: string; env: NodeJS.ProcessEnv }): AgentGuaranteeExecutionProviderMode {
	const configured = input.env.TREESEED_AGENT_GUARANTEE_EXECUTION_PROVIDER?.trim();
	if (configured === 'mock' || configured === 'live-codex' || configured === 'auto') return configured;
	if (input.env.CI === 'true' || input.env.GITHUB_ACTIONS === 'true') return 'mock';
	if (input.environment === 'staging') return 'live-codex';
	return 'auto';
}

function applyAgentGuaranteeExecutionProviderMode(input: { environment: string; env: NodeJS.ProcessEnv }) {
	const mode = resolveAgentGuaranteeExecutionProviderMode(input);
	input.env.TREESEED_AGENT_GUARANTEE_EXECUTION_PROVIDER = mode;
	if (mode === 'mock') {
		input.env.TREESEED_AGENT_EXECUTION_PROVIDER = 'mock';
		return { ok: true, diagnostics: ['Agent guarantees will use the deterministic mock execution provider.'] };
	}
	if (mode === 'live-codex') {
		if (!codexAuthAvailable(input.env)) {
			return { ok: false, diagnostics: ['missing_codex_auth: live Codex agent guarantees require ~/.codex/auth.json or TREESEED_CODEX_AUTH_FILE.'] };
		}
		input.env.TREESEED_AGENT_EXECUTION_PROVIDER = 'codex';
		return { ok: true, diagnostics: ['Agent guarantees will use the live Codex execution provider.'] };
	}
	if (codexAuthAvailable(input.env)) {
		input.env.TREESEED_AGENT_EXECUTION_PROVIDER = 'codex';
		return { ok: true, diagnostics: ['Agent guarantee auto mode selected live Codex because Codex auth was detected.'] };
	}
	input.env.TREESEED_AGENT_EXECUTION_PROVIDER = 'mock';
	return { ok: true, diagnostics: ['Agent guarantee auto mode selected deterministic mock provider because Codex auth was not detected.'] };
}

function planNeedsLocalDev(input: { environment: string; filter: TreeseedGuaranteeFilter; includeDependencies?: boolean; includePlanned?: boolean; cwd: string }) {
	if (input.environment !== 'local') return false;
	const plan = planTreeseedGuarantees({
		workspaceRoot: input.cwd,
		filter: input.filter,
		environment: input.environment,
		includeDependencies: input.includeDependencies,
	});
	return plan.entries.some((entry) => {
		if (entry.status !== 'active') return false;
		return Boolean(entry.sceneManifest || entry.apiVerifierRefs.length > 0);
	});
}

async function localDevEndpointsReady() {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 2_500);
	try {
		const [web, api] = await Promise.all([
			fetch('http://127.0.0.1:4321/', { method: 'GET', signal: controller.signal }),
			fetch('http://127.0.0.1:3000/healthz', { method: 'GET', signal: controller.signal }),
		]);
		return web.ok && api.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

async function ensureLocalDevForGuaranteeRun(context: Parameters<TreeseedCommandHandler>[1], input: { filter: TreeseedGuaranteeFilter; includeDependencies?: boolean; includePlanned?: boolean }) {
	if (process.env.TREESEED_GUARANTEE_SKIP_LOCAL_DEV === '1') return { ok: true, diagnostics: [] as string[] };
	if (!planNeedsLocalDev({ environment: 'local', filter: input.filter, includeDependencies: input.includeDependencies, includePlanned: input.includePlanned, cwd: context.cwd })) {
		return { ok: true, diagnostics: [] as string[] };
	}
	if (context.env.TREESEED_GUARANTEE_BYPASS_LOCAL_DEV_PREFLIGHT !== '1' && await localDevEndpointsReady()) {
		return { ok: true, diagnostics: ['Managed local dev web/API endpoints were already healthy before local guarantee execution.'] };
	}
	const result = context.env.TREESEED_GUARANTEE_MOCK_LOCAL_DEV === '1'
		? { ok: true }
		: await runTreeseedManagedDev({
				action: 'start',
				cwd: context.cwd,
				surfaces: 'web,api',
				webRuntime: 'local',
				force: true,
				forceConflicts: true,
				env: context.env,
			});
	if (!result.ok) {
		return {
			ok: false,
			diagnostics: ['Managed local dev startup failed before guarantee execution. Run `npx trsd dev restart --web-runtime local --app web --force --force-conflicts --json` and retry, then verify API health at http://127.0.0.1:3000/healthz.'],
		};
	}
	return {
		ok: true,
		diagnostics: ['Managed local dev web/API surfaces were started or verified before local guarantee execution.'],
	};
}

export const handleGuarantees: TreeseedCommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'status';
	const { filter, diagnostics: filterDiagnostics } = filterFromArgs(invocation.args);
	if (filterDiagnostics.length > 0) {
		return {
			exitCode: 1,
			stdout: [],
			stderr: filterDiagnostics,
			report: { command: `guarantees ${action}`, ok: false, diagnostics: filterDiagnostics.map((message) => ({ severity: 'error', code: 'guarantees.invalid_filter', message })) },
		};
	}

	if (action === 'status') {
		const report = createTreeseedGuaranteeStatusReport({ workspaceRoot: context.cwd });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: [
				'Treeseed guarantee framework status',
				`Guarantees: ${report.counts.valid}/${report.counts.total}`,
				`Verifier registries: ${report.verifierRegistries}`,
				`Errors: ${report.counts.errors}`,
				`Warnings: ${report.counts.warnings}`,
			],
			stderr: report.ok ? [] : humanDiagnostics(report.diagnostics.filter((entry) => entry.severity === 'error')),
			report: { command: 'guarantees status', ...report },
		};
	}

	if (action === 'validate') {
		const report = discoverTreeseedGuarantees({ workspaceRoot: context.cwd, filter });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed guarantee validation passed.',
					`Guarantees: ${report.counts.valid}/${report.counts.total}`,
					`Selected: ${report.counts.selected ?? report.counts.valid}`,
					`Warnings: ${report.counts.warnings}`,
				]
				: ['Treeseed guarantee validation failed.', ...humanDiagnostics(report.diagnostics)],
			stderr: [],
			report: { command: 'guarantees validate', ...report },
		};
	}

	if (action === 'plan') {
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment : 'local';
		const report = planTreeseedGuarantees({ workspaceRoot: context.cwd, filter, environment, includeDependencies: invocation.args.dependencies === false || invocation.args.noDependencies === true ? false : undefined });
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed guarantee plan ready.',
					`Environment: ${report.environment}`,
					`Selected: ${report.counts.selected}`,
					`With dependencies: ${report.counts.withDependencies}`,
				]
				: ['Treeseed guarantee plan failed.', ...humanDiagnostics(report.diagnostics)],
			stderr: [],
			report: { command: 'guarantees plan', ...report },
		};
	}

	if (action === 'audit-journeys') {
		const writeReport = typeof invocation.args.writeReport === 'string'
			? invocation.args.writeReport
			: typeof invocation.args.output === 'string'
				? invocation.args.output
				: undefined;
		const audit = auditTreeseedGuaranteeJourneys({ workspaceRoot: context.cwd, filter, writeReport });
		return {
			exitCode: audit.ok ? 0 : 1,
			stdout: [
				'Treeseed guarantee journey audit completed.',
				`Guarantees: ${audit.totals.guarantees}`,
				`Scene-backed: ${audit.totals.sceneBacked}`,
				`Active scene-backed: ${audit.totals.activeSceneBacked}`,
				`Active weak scene-backed: ${audit.totals.activeSceneBackedWeak}`,
				`Active missing routes: ${audit.totals.activeMissingRoutes}`,
				`Active missing selectors: ${audit.totals.activeMissingSelectors}`,
				...(writeReport ? [`Report: ${writeReport}`] : []),
			],
			stderr: audit.ok ? [] : humanDiagnostics(audit.diagnostics.filter((entry) => entry.severity === 'error')).slice(0, 30),
			report: { command: 'guarantees audit-journeys', ...(writeReport ? { reportPath: writeReport } : {}), ...audit },
		};
	}

	if (action === 'export') {
		const format = typeof invocation.args.format === 'string' ? invocation.args.format : 'csv';
		if (!VALID_FORMATS.has(format)) {
			return {
				exitCode: 1,
				stdout: [],
				stderr: [`Unsupported guarantee export format: ${format}. Use csv, json, or markdown.`],
				report: { command: 'guarantees export', ok: false, error: 'Unsupported format.' },
			};
		}
		const output = typeof invocation.args.output === 'string' ? invocation.args.output : '';
		const registry = discoverTreeseedGuarantees({ workspaceRoot: context.cwd, filter });
		if (output) {
			const result = writeTreeseedGuaranteesExport({ workspaceRoot: context.cwd, output, format: format as 'csv' | 'json' | 'markdown', filter });
			return {
				exitCode: result.ok ? 0 : 1,
				stdout: [`Treeseed guarantee ${format} export written.`, `Path: ${result.outputPath}`],
				stderr: result.ok ? [] : humanDiagnostics(result.registry.diagnostics),
				report: { command: 'guarantees export', format, outputPath: result.outputPath, ...result.registry },
			};
		}
		const content = format === 'csv'
			? exportTreeseedGuaranteesCsv({ guarantees: registry.guarantees, filter })
			: format === 'json'
				? `${JSON.stringify(exportTreeseedGuaranteesJson({ registry, filter }), null, 2)}\n`
				: exportTreeseedGuaranteesMarkdown({ registry, filter });
		context.write(content.trimEnd(), 'stdout');
		return {
			exitCode: registry.ok ? 0 : 1,
			stdout: [],
			stderr: registry.ok ? [] : humanDiagnostics(registry.diagnostics),
			report: { command: 'guarantees export', format, ...registry },
			suppressJsonResult: true,
		};
	}

	if (action === 'run') {
		const environment = typeof invocation.args.environment === 'string' ? invocation.args.environment : 'local';
		const outputRoot = typeof invocation.args.output === 'string' ? invocation.args.output : undefined;
		const evidenceTarget = typeof invocation.args.evidenceTarget === 'string' && ['local', 'ci', 'release'].includes(invocation.args.evidenceTarget)
			? invocation.args.evidenceTarget as 'local' | 'ci' | 'release'
			: undefined;
		const device = typeof invocation.args.device === 'string' ? invocation.args.device : undefined;
		const includeDependencies = invocation.args.dependencies === false || invocation.args.noDependencies === true ? false : undefined;
		const includePlanned = invocation.args.includePlanned === true;
		const agentExecutionProvider = filter.ownerPackage === '@treeseed/agent'
			? applyAgentGuaranteeExecutionProviderMode({ environment, env: context.env })
			: { ok: true, diagnostics: [] as string[] };
		if (!agentExecutionProvider.ok) {
			return {
				exitCode: 1,
				stdout: [
					'Treeseed guarantee run blocked before execution.',
					'Agent live execution provider credentials are unavailable.',
					...agentExecutionProvider.diagnostics,
				],
				stderr: [],
				report: {
					command: 'guarantees run',
					ok: false,
					environment,
					error: 'missing_codex_auth',
					diagnostics: agentExecutionProvider.diagnostics.map((message) => ({ severity: 'error', code: 'guarantees.missing_codex_auth', message })),
				},
			};
		}
		const localDev = environment === 'local'
			? await ensureLocalDevForGuaranteeRun(context, { filter, includeDependencies, includePlanned })
			: { ok: true, diagnostics: [] as string[] };
		if (!localDev.ok) {
			return {
				exitCode: 1,
				stdout: [
					'Treeseed guarantee run blocked before execution.',
					'Managed local dev could not be started for local guarantee execution.',
					...localDev.diagnostics,
				],
				stderr: [],
				report: {
					command: 'guarantees run',
					ok: false,
					environment,
					error: 'local_dev_start_failed',
					diagnostics: localDev.diagnostics.map((message) => ({ severity: 'error', code: 'guarantees.local_dev_start_failed', message })),
				},
			};
		}
		const acceptanceEnv = loadApiAcceptanceServiceEnv(environment);
		if ((environment === 'staging' || environment === 'prod') && !acceptanceEnv.loaded) {
			return {
				exitCode: 1,
				stdout: [
					'Treeseed guarantee run blocked before execution.',
					`${environment} API acceptance credentials are unavailable.`,
					...acceptanceEnv.diagnostics,
				],
				stderr: [],
				report: {
					command: 'guarantees run',
					ok: false,
					environment,
					error: 'api_acceptance_credentials_missing',
					diagnostics: acceptanceEnv.diagnostics.map((message) => ({ severity: 'error', code: 'guarantees.acceptance_credentials_missing', message })),
				},
			};
		}
		const report = await runTreeseedGuarantees({
			workspaceRoot: context.cwd,
			filter,
			environment,
			outputRoot,
			includeDependencies,
			includePlanned,
			record: invocation.args.record === true,
			sceneArtifacts: invocation.args.noSceneVideo === true ? 'screenshots' : typeof invocation.args.sceneArtifacts === 'string' ? invocation.args.sceneArtifacts as 'full' | 'screenshots' : undefined,
			device,
			evidenceTarget,
			onProgress: (line, stream = 'stderr') => context.write(line, stream === 'stdout' ? 'stderr' : stream),
		});
		return {
			exitCode: report.ok ? 0 : 1,
			stdout: report.ok
				? [
					'Treeseed guarantee run completed.',
					`Environment: ${report.environment}`,
					`Run: ${report.runId}`,
					`Passed: ${report.counts.passed}`,
					`Skipped: ${report.counts.skipped}`,
					`Output: ${report.outputRoot}`,
					...localDev.diagnostics,
					...acceptanceEnv.diagnostics,
					...agentExecutionProvider.diagnostics,
				]
				: [
					'Treeseed guarantee run failed.',
					`Environment: ${report.environment}`,
					`Run: ${report.runId}`,
					`Failed: ${report.counts.failed}`,
					`Blocked: ${report.counts.blocked}`,
					`Release blocking failures: ${report.counts.releaseBlockingFailures}`,
					`Output: ${report.outputRoot}`,
					...localDev.diagnostics,
					...acceptanceEnv.diagnostics,
					...agentExecutionProvider.diagnostics,
					...humanDiagnostics(report.diagnostics.filter((entry) => entry.severity === 'error')).slice(0, 20),
				],
			stderr: [],
			report: { command: 'guarantees run', ...report },
		};
	}

	return {
		exitCode: 1,
		stdout: [],
		stderr: [`Unsupported guarantees action "${action}". Use status, validate, audit-journeys, plan, export, or run.`],
		report: { command: 'guarantees', ok: false, error: `Unsupported action: ${action}` },
	};
};
