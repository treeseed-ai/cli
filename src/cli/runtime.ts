import { createCommandResult, type CommandErrorCategory } from '@treeseed/sdk/operator-contracts';
import { runAuth } from './commands/auth.js';
import { renderHelp } from './help.js';
import { runOperator } from './commands/operator.js';
import { parseInvocation } from './parser.js';
import { isCommandBranch, resolveCommand } from './registry.js';
import { runSecrets } from './commands/secrets.js';
import { runHost } from './commands/host.js';
import { runUsers } from './commands/users.js';
import { runLibrary } from './commands/library.js';
import { runTeams } from './commands/teams.js';
import type { CommandContext, CommandFailure, ParsedInvocation, Writer } from './types.js';
import { promptText } from './support/prompts.js';
import { handoffProviderEnrollment } from './support/provider-enrollment.js';
import { renderHumanCommandResult } from './support/human-renderer.js';

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

export function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const env = overrides.env ?? process.env;
	const context: CommandContext = { cwd: overrides.cwd ?? process.cwd(), env, write: overrides.write ?? defaultWrite as Writer, outputFormat: overrides.outputFormat ?? 'human', interactiveUi: overrides.interactiveUi ?? true, prompt: overrides.prompt, promptSecret: overrides.promptSecret, confirm: overrides.confirm, operationInvoke: overrides.operationInvoke, hostInvoke: overrides.hostInvoke,
		providerEnrollmentHandoff: overrides.providerEnrollmentHandoff ?? ((input) => handoffProviderEnrollment(input, env)) };
	if (!context.confirm && context.interactiveUi) context.confirm = async (question) => /^y(?:es)?$/iu.test(await promptText(context, `${question} [y/N] `));
	return context;
}

function envelope(invocation: ParsedInvocation, ok: boolean, result: unknown, failure?: CommandFailure) {
	return createCommandResult({ commandPath: invocation.command.path, mode: invocation.options.plan === true ? 'plan' : 'execute', ok, result: result ?? null, error: failure ?? null, warnings: [], blockers: failure ? [{ code: failure.code, message: failure.message }] : [], receipts: [], nextActions: [] });
}

function failure(category: CommandErrorCategory, code: string, message: string): CommandFailure { return { category, code, message }; }

function categorized(error: unknown): CommandFailure {
	const value = error as { category?: CommandErrorCategory; code?: string; message?: string; status?: number; problem?: { code?: string; detail?: string; title?: string } };
	if (value.category) return failure(value.category, value.code ?? 'command_failed', value.message ?? String(error));
	const code = value.problem?.code ?? value.code ?? 'command_failed';
	const message = value.problem?.detail ?? value.problem?.title ?? value.message ?? String(error);
	if (code === 'confirmation_required' || code === 'confirmation_invalid') return failure('confirmation_required', code, message);
	if (code === 'stale_preflight') return failure('stale_preflight', code, message);
	if (value.status === 400 || value.status === 412) return failure('invalid_input', code, message);
	if (value.status === 401) return failure('authentication_required', code, message);
	if (value.status === 403) return failure('authorization_denied', code, message);
	if (value.status === 404) return failure('not_found', code, message);
	if (value.status === 409) return failure('conflict', code, message);
	if (value.status === 429) return failure('rate_limited', code, message);
	if (value.status && value.status >= 500) return failure('provider_unavailable', code, message);
	return failure('internal_error', code, message);
}

async function confirmed(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.confirmation === 'never' || invocation.options.plan === true || invocation.options.yes === true || invocation.options.confirm === true || invocation.command.execution.kind === 'operation') return true;
	if (!context.interactiveUi || !context.confirm) return false;
	return context.confirm(`Execute governed operation \`${invocation.command.name}\`?`, 'no');
}

async function execute(invocation: ParsedInvocation, context: CommandContext) {
	if (!(await confirmed(invocation, context))) throw Object.assign(new Error('Interactive confirmation is required, or pass --yes for authorized automation.'), { category: 'confirmation_required', code: 'confirmation_required' });
	if (invocation.options.plan === true && ['auth', 'secrets'].includes(invocation.command.path[0]!)) return { action: invocation.command.name, mutation: false, authority: 'local_credential_custody' };
	if (invocation.command.path[0] === 'users') return runUsers(invocation, context);
	if (invocation.command.execution.kind === 'local' && invocation.command.path[0] === 'teams') return runTeams(invocation, context);
	if (invocation.command.execution.kind === 'protocol') return runAuth(invocation, context);
	if (invocation.command.execution.kind === 'local' && invocation.command.path[0] === 'secrets') return runSecrets(invocation, context);
	if (invocation.command.execution.kind === 'local' && invocation.command.path[0] === 'host') return runHost(invocation, context);
	if (invocation.command.execution.kind === 'local' && invocation.command.path[0] === 'library') return runLibrary(invocation, context);
	return runOperator(invocation, context);
}

function print(context: CommandContext, value: unknown, ok = true) {
	if (context.outputFormat === 'json') context.write(JSON.stringify(value, null, 2), ok ? 'stdout' : 'stderr');
	else if (ok) context.write(typeof value === 'string' ? value : renderHumanCommandResult(value, { color: Boolean(process.stdout.isTTY && !context.env.NO_COLOR), width: Number(context.env.COLUMNS) || process.stdout.columns || 100 }), 'stdout');
	else {
		const message = value && typeof value === 'object' && 'error' in value ? (value as { error?: { message?: string } }).error?.message : null;
		context.write(message ?? String(value), 'stderr');
	}
}

export async function runCommandLine(argv: string[], overrides: Partial<CommandContext> = {}) {
	const context = createCommandContext({ ...overrides, outputFormat: argv.includes('--json') ? 'json' : overrides.outputFormat });
	if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { print(context, renderHelp()); return 0; }
	if (argv[0] === 'help') { const path = argv.slice(1).join(' '); const output = renderHelp(path); print(context, output, !output.startsWith('Unknown')); return output.startsWith('Unknown') ? 1 : 0; }
	const resolved = resolveCommand(argv);
	if (!resolved) {
		const branch = argv.filter((value) => !value.startsWith('-')).join(' ');
		if (isCommandBranch(branch)) { print(context, renderHelp(branch)); return 0; }
		const message = `Unknown trsd command: ${argv[0]}`;
		print(context, createCommandResult({ commandPath: [argv[0]!], mode: 'execute', ok: false, result: null, error: failure('unknown_command', 'unknown_command', message), warnings: [], blockers: [{ code: 'unknown_command', message }], receipts: [], nextActions: ['trsd help'] }), false);
		return 1;
	}
	if (resolved.rest.includes('--help') || resolved.rest.includes('-h')) { print(context, renderHelp(resolved.command.name)); return 0; }
	let invocation: ParsedInvocation;
	try { invocation = parseInvocation(resolved.command, resolved.rest); }
	catch (error) { const message = error instanceof Error ? error.message : String(error); const stub = { command: resolved.command, arguments: [], options: {} }; print(context, envelope(stub, false, null, failure('invalid_input', 'invalid_input', message)), false); return 1; }
	try {
		const response = await execute(invocation, context);
		const api = response && typeof response === 'object' ? response as { ok?: boolean; payload?: unknown; code?: string; error?: string } : null;
		if (api?.ok === false) { const failed = failure('policy_blocked', api.code ?? 'control_plane_rejected', api.error ?? 'The control plane rejected the operation.'); print(context, envelope(invocation, false, null, failed), false); return 1; }
		const result = api && 'payload' in api ? api.payload : response && typeof response === 'object' && 'data' in response ? (response as { data: unknown }).data : response;
		print(context, envelope(invocation, true, result)); return 0;
	} catch (error) {
		const failed = categorized(error);
		const partial = error && typeof error === 'object' && 'partialResult' in error ? (error as { partialResult?: unknown }).partialResult : null;
		const failedEnvelope = envelope(invocation, false, partial, failed);
		if (context.outputFormat === 'human' && invocation.command.name === 'send' && partial) {
			context.write(renderHumanCommandResult({ ...failedEnvelope, ok: true }, { color: Boolean(process.stdout.isTTY && !context.env.NO_COLOR), width: Number(context.env.COLUMNS) || process.stdout.columns || 100 }), 'stdout');
			context.write(failed.message, 'stderr');
		} else print(context, failedEnvelope, false);
		return 1;
	}
}
