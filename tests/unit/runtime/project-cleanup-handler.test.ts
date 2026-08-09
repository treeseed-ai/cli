import { existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import { handleCleanup } from '../../../src/cli/handlers/diagnostics/cleanup.ts';

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createGeneratedLog() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-project-cleanup-'));
	temporaryRoots.push(root);
	const logPath = resolve(root, '.treeseed/logs/old.log');
	mkdirSync(resolve(root, '.treeseed/logs'), { recursive: true });
	writeFileSync(logPath, 'generated log');
	return { root, logPath };
}

function invoke(root: string, args: Record<string, boolean | string>) {
	return handleCleanup({
		commandName: 'cleanup',
		args,
		positionals: ['local'],
		rawArgs: [],
	}, {
		cwd: root,
		env: {},
		write: (() => undefined) as never,
		spawn: (() => undefined) as never,
	});
}

describe('project cleanup handler', () => {
	it('plans cleanup without mutating generated project data', async () => {
		const { root,logPath } = createGeneratedLog();
		const result = await invoke(root, { plan: true, mode: 'standard' });

		expect(result.exitCode).toBe(0);
		expect(existsSync(logPath)).toBe(true);
		expect(result.report?.executionMode).toBe('plan');
	});

	it('requires confirmation before live cleanup', async () => {
		const { root,logPath } = createGeneratedLog();
		const result = await invoke(root, { mode: 'standard' });

		expect(result.exitCode).toBe(1);
		expect(existsSync(logPath)).toBe(true);
		expect(result.report?.error).toBe('Confirmation required.');
	});

	it('removes planned generated data after confirmation', async () => {
		const { root,logPath } = createGeneratedLog();
		const result = await invoke(root, { yes: true, mode: 'standard' });

		expect(result.exitCode).toBe(0);
		expect(existsSync(logPath)).toBe(false);
		expect(result.report?.executionMode).toBe('live');
	});
});
