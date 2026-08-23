import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { controlPlaneOperation, encodeConfirmationState, type CommandInputBinding } from '@treeseed/sdk/operator-contracts';
import { ControlPlaneClientError } from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { createControlPlaneClient } from '../support/client.js';

function sourceValue(binding: CommandInputBinding, invocation: ParsedInvocation, context: CommandContext) {
	if (binding.source === 'argument') {
		const index = invocation.command.arguments.findIndex((argument) => argument.name === binding.name);
		return index < 0 ? undefined : invocation.arguments[index];
	}
	if (binding.source === 'option') return invocation.options[binding.name];
	if (binding.name === 'team') return invocation.options.team ?? context.env.TREESEED_TEAM_ID;
	if (binding.name === 'project') return invocation.options.project ?? context.env.TREESEED_PROJECT_ID;
	return invocation.options[binding.name] ?? context.env[`TREESEED_${binding.name.replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase()}_ID`];
}

function transform(value: unknown, binding: CommandInputBinding) {
	if (value === undefined || value === null || value === '') return undefined;
	if (binding.transform === 'integer') {
		const parsed = Number(value);
		if (!Number.isInteger(parsed)) throw new Error(`${binding.name} must be an integer.`);
		return parsed;
	}
	if (binding.transform === 'csv') return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
	return value;
}

async function operationInput(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.execution.kind !== 'operation') throw new Error('Command is not operation-bound.');
	const input = { path: {} as Record<string, unknown>, query: {} as Record<string, unknown>, body: {} as Record<string, unknown> };
	const deferred: CommandInputBinding[] = [];
	for (const binding of invocation.command.execution.input) {
		const value = transform(sourceValue(binding, invocation, context), binding);
		if (binding.required && value === undefined) { deferred.push(binding); continue; }
		if (value !== undefined) input[binding.target][binding.field] = value;
	}
	const operation = controlPlaneOperation(invocation.command.execution.operationId);
	if (operation.descriptor.operationId.startsWith('seeds.') && typeof input.body.file === 'string') {
		const file = resolve(context.cwd, input.body.file);
		const parsed = parseYaml(await readFile(file, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('Seed file must contain one portable seed bundle object.'), { category: 'invalid_input', code: 'seed_bundle_file_invalid' });
		delete input.body.file;
		input.body.bundle = parsed;
		if (typeof input.path.name !== 'string' && typeof (parsed as Record<string, unknown>).name === 'string') input.path.name = (parsed as Record<string, unknown>).name;
	}
	for (const binding of deferred) if (input[binding.target][binding.field] === undefined) {
		throw Object.assign(new Error(`Missing required ${binding.source}: ${binding.name}`), { category: 'ambiguous_context', code: `${binding.name}_required` });
	}
	return { operation, input: { ...input, body: Object.keys(input.body).length ? input.body : undefined } };
}

export async function runOperator(invocation: ParsedInvocation, context: CommandContext) {
	const execution = invocation.command.execution;
	if (execution.kind === 'unavailable') throw Object.assign(new Error(execution.reason), { category: 'policy_blocked', code: execution.code });
	if (execution.kind !== 'operation') throw Object.assign(new Error(`No CLI handler is installed for ${execution.handlerId}.`), { category: 'policy_blocked', code: 'local_handler_unavailable' });
	const { operation, input } = await operationInput(invocation, context);
	if (invocation.options.plan === true) return { operationId: operation.descriptor.operationId, input, mutation: false };
	if (context.operationInvoke) return context.operationInvoke(operation.descriptor.operationId, input);
	const { client, profile } = await createControlPlaneClient(invocation, context, operation.descriptor.authentication !== 'anonymous');
	const options = operation.descriptor.kind === 'mutation' ? { idempotencyKey: randomUUID(), headers: {} as Record<string, string> } : { headers: {} as Record<string, string> };
	const finalize = async (response: unknown) => {
		const value = response as Record<string, unknown>;
		if (operation.descriptor.operationId === 'providers.connect') {
			const enrollmentToken = typeof value.enrollmentToken === 'string' ? value.enrollmentToken : null;
			if (!enrollmentToken || !context.providerEnrollmentHandoff) throw Object.assign(new Error('The control plane did not return a usable local provider enrollment handoff.'), { category: 'provider_unavailable', code: 'provider_enrollment_handoff_invalid' });
			const receipt = await context.providerEnrollmentHandoff({ action: 'begin', ...value, enrollmentToken,
				controlPlaneUrl: profile.baseUrl, controlPlaneAudience: profile.baseUrl, serverProfile: profile.serverId });
			return { teamId: value.teamId, connectionState: 'approval_required', provider: receipt };
		}
		if (operation.descriptor.operationId === 'providers.requests.approve' && context.providerEnrollmentHandoff) {
			const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata as Record<string, unknown> : {};
			const connectionId = typeof metadata.connectionId === 'string' ? metadata.connectionId : null;
			if (connectionId) return { ...value, provider: await context.providerEnrollmentHandoff({ action: 'complete', connectionId }) };
		}
		return response;
	};
	try {
		return await finalize(await client.invoke(operation, input, options));
	} catch (error) {
		const required = error instanceof ControlPlaneClientError ? error.problem.inputRequired : undefined;
		if (!required) throw error;
		const approved = invocation.options.yes === true || (context.interactiveUi && context.confirm ? await context.confirm(required.prompt, 'no') : false);
		if (!approved) throw Object.assign(new Error(required.prompt), { category: 'confirmation_required', code: 'confirmation_required' });
		options.headers['x-treeseed-confirmation'] = encodeConfirmationState(required.confirmation);
		return finalize(await client.invoke(operation, input, options));
	}
}
