import type { TreeseedCommandContext, TreeseedCommandResult } from '../types.js';

export function ok(lines: string[] = []): TreeseedCommandResult {
	return { exitCode: 0, stdout: lines };
}

export function fail(message: string, exitCode = 1): TreeseedCommandResult {
	return { exitCode, stderr: [message] };
}

type GuidedResultOptions = {
	command: string;
	summary: string;
	facts?: Array<{ label: string; value: string | number | boolean | null | undefined }>;
	sections?: Array<{ title: string; lines: string[] }>;
	nextSteps?: string[];
	report?: Record<string, unknown> | null;
	exitCode?: number;
	stderr?: string[];
};

export function guidedResult(options: GuidedResultOptions): TreeseedCommandResult {
	const lines: string[] = [options.summary];
	const facts = (options.facts ?? []).filter((fact) => fact.value !== undefined && fact.value !== null && `${fact.value}`.length > 0);
	if (facts.length > 0) {
		lines.push('');
		for (const fact of facts) {
			lines.push(`${fact.label}: ${fact.value}`);
		}
	}
	for (const section of options.sections ?? []) {
		const sectionLines = section.lines.filter((line) => line.length > 0);
		if (sectionLines.length === 0) continue;
		lines.push('', `${section.title}:`, ...sectionLines);
	}
	if ((options.nextSteps ?? []).length > 0) {
		lines.push('', 'Next steps:');
		for (const step of options.nextSteps ?? []) {
			lines.push(`- ${step}`);
		}
	}
	const report = options.report && typeof options.report === 'object'
		? {
			...(options.report as Record<string, unknown>),
			command: options.command,
			ok: (options.exitCode ?? 0) === 0,
			summary: options.summary,
			facts: facts.map((fact) => ({ label: fact.label, value: fact.value })),
			sections: options.sections ?? [],
			nextSteps: options.nextSteps ?? [],
		}
		: {
			command: options.command,
			ok: (options.exitCode ?? 0) === 0,
			summary: options.summary,
			facts: facts.map((fact) => ({ label: fact.label, value: fact.value })),
			sections: options.sections ?? [],
			nextSteps: options.nextSteps ?? [],
		};
	return {
		exitCode: options.exitCode ?? 0,
		stdout: lines,
		stderr: options.stderr,
		report,
	};
}

export function writeResult(result: TreeseedCommandResult, context: TreeseedCommandContext) {
	if (context.outputFormat === 'json') {
		if (result.suppressJsonResult === true) {
			return result.exitCode ?? 0;
		}
		const payload = result.report ?? {
			ok: (result.exitCode ?? 0) === 0,
			stdout: result.stdout ?? [],
			stderr: result.stderr ?? [],
		};
		context.write(JSON.stringify(payload, null, 2), (result.exitCode ?? 0) === 0 ? 'stdout' : 'stderr');
		return result.exitCode ?? 0;
	}

	for (const line of result.stdout ?? []) {
		context.write(line, 'stdout');
	}
	for (const line of result.stderr ?? []) {
		context.write(line, 'stderr');
	}
	return result.exitCode ?? 0;
}
