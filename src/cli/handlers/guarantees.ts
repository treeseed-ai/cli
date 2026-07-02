import {
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
		const acceptanceEnv = loadApiAcceptanceServiceEnv(environment);
		const report = await runTreeseedGuarantees({
			workspaceRoot: context.cwd,
			filter,
			environment,
			outputRoot,
			includeDependencies: invocation.args.dependencies === false || invocation.args.noDependencies === true ? false : undefined,
			includePlanned: invocation.args.includePlanned === true,
			record: invocation.args.record === true,
			sceneArtifacts: invocation.args.noSceneVideo === true ? 'screenshots' : typeof invocation.args.sceneArtifacts === 'string' ? invocation.args.sceneArtifacts as 'full' | 'screenshots' : undefined,
			device,
			evidenceTarget,
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
					...acceptanceEnv.diagnostics,
				]
				: [
					'Treeseed guarantee run failed.',
					`Environment: ${report.environment}`,
					`Run: ${report.runId}`,
					`Failed: ${report.counts.failed}`,
					`Blocked: ${report.counts.blocked}`,
					`Release blocking failures: ${report.counts.releaseBlockingFailures}`,
					`Output: ${report.outputRoot}`,
					...acceptanceEnv.diagnostics,
					...humanDiagnostics(report.diagnostics.filter((entry) => entry.severity === 'error')).slice(0, 20),
				],
			stderr: [],
			report: { command: 'guarantees run', ...report },
		};
	}

	return {
		exitCode: 1,
		stdout: [],
		stderr: [`Unsupported guarantees action "${action}". Use status, validate, plan, export, or run.`],
		report: { command: 'guarantees', ok: false, error: `Unsupported action: ${action}` },
	};
};
