import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { handleClean } from '../../../src/cli/handlers/diagnostics/cleanup.ts';
import type { CommandContext, ParsedInvocation } from '../../../src/cli/types.ts';
import { makeTenantWorkspace } from '../../support/cli-test-fixtures.ts';

function invocation(args: ParsedInvocation['args'], action?: string): ParsedInvocation {
	return { commandName: 'clean', positionals: action ? [action] : [], rawArgs: [], args };
}

function context(root: string, confirm?: CommandContext['confirm']): CommandContext {
	return {
		cwd: root,
		env: {},
		write: () => undefined,
		spawn: () => ({ status: 0 }),
		outputFormat: 'json',
		interactiveUi: false,
		confirm,
	};
}

test('project cleanup plan reports targets without deleting them', async () => {
	const root = makeTenantWorkspace();
	const log = join(root, '.treeseed', 'logs', 'platform.log');
	mkdirSync(join(log, '..'), { recursive: true });
	writeFileSync(log, 'generated');

	const result = await handleClean(invocation({ plan: true, json: true }), context(root));

	assert.equal(result.exitCode, 0, JSON.stringify(result));
	assert.equal(existsSync(log), true);
	assert.equal(result.report?.command, 'clean project');
	assert.equal(result.report?.executionMode, 'plan');
});

test('project cleanup requires confirmation and then removes generated data', async () => {
	const root = makeTenantWorkspace();
	const log = join(root, '.treeseed', 'logs', 'platform.log');
	mkdirSync(join(log, '..'), { recursive: true });
	writeFileSync(log, 'generated');

	const declined = await handleClean(invocation({}), context(root));
	assert.equal(declined.exitCode, 1);
	assert.equal(existsSync(log), true);

	const accepted = await handleClean(invocation({ yes: true }), context(root));
	assert.equal(accepted.exitCode, 0, JSON.stringify(accepted));
	assert.equal(existsSync(log), false);
	assert.equal(accepted.report?.command, 'clean project');
});
