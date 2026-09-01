import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { controlPlaneOperation, encodeConfirmationState, parseCommunicationAddresses, type CommandInputBinding } from '@treeseed/sdk/operator-contracts';
import { ControlPlaneClientError, defaultLocalControlPlaneServer, resolveControlPlaneServer } from '@treeseed/sdk/control-plane-client';
import type { CommandContext, ParsedInvocation } from '../types.js';
import { runInteractiveChat } from '../communication/interactive-chat.js';
import { createControlPlaneClient } from '../support/client.js';
import { loadServerRegistry, loadServerSession } from '../support/server-custody.js';
import { renderCommunicationResponses } from '../support/human-renderer.js';

function activeTeam(invocation: ParsedInvocation, context: CommandContext) {
	const local = defaultLocalControlPlaneServer(context.env as Record<string, string | undefined>);
	const stored = loadServerRegistry(context.env);
	const registry = { version: 1 as const, activeServerId: stored.activeServerId || local.serverId, servers: [...stored.servers.filter((entry) => entry.serverId !== local.serverId), local] };
	const selector = typeof invocation.options.server === 'string' ? invocation.options.server : undefined;
	return loadServerSession(resolveControlPlaneServer(selector, registry).serverId, context.env)?.activeTeam?.id;
}

function sourceValue(binding: CommandInputBinding, invocation: ParsedInvocation, context: CommandContext) {
	if (binding.source === 'argument') {
		const index = invocation.command.arguments.findIndex((argument) => argument.name === binding.name);
		return index < 0 ? undefined : invocation.arguments[index];
	}
	if (binding.source === 'option') return invocation.options[binding.name];
	if (binding.name === 'team') return invocation.options.team ?? context.env.TREESEED_TEAM_ID ?? activeTeam(invocation, context);
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

async function inputDocument(fileValue: string, context: CommandContext) {
	if (fileValue !== '-') return readFile(resolve(context.cwd, fileValue), 'utf8');
	let source = '';
	process.stdin.setEncoding('utf8');
	for await (const chunk of process.stdin) source += String(chunk);
	return source;
}

async function portableSeedBundle(fileValue: string, context: CommandContext) {
	const parsed = parseYaml(await inputDocument(fileValue, context));
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('Seed file must contain one portable seed bundle object.'), { category: 'invalid_input', code: 'seed_bundle_file_invalid' });
	return parsed as Record<string, unknown>;
}

function looksLikeSeedFile(value: string) {
	return /(?:^|[/\\])[^/\\]+\.(?:json|ya?ml)$/iu.test(value);
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
		const parsed = await portableSeedBundle(input.body.file, context);
		delete input.body.file;
		input.body.bundle = parsed;
		if (operation.descriptor.rest?.path.includes('{name}')
			&& typeof input.path.name !== 'string'
			&& typeof (parsed as Record<string, unknown>).name === 'string') {
			input.path.name = (parsed as Record<string, unknown>).name;
		}
	}
	if (operation.descriptor.operationId === 'seeds.verify'
		&& typeof input.path.name === 'string'
		&& looksLikeSeedFile(input.path.name)) {
		const parsed = await portableSeedBundle(input.path.name, context);
		if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw Object.assign(new Error('Seed file must declare a name.'), { category: 'invalid_input', code: 'seed_bundle_name_required' });
		input.path.name = parsed.name;
		input.body.bundle = parsed;
	}
	if (!operation.descriptor.operationId.startsWith('seeds.') && typeof input.body.file === 'string') {
		const parsed = parseYaml(await inputDocument(input.body.file, context));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('Input file must contain one YAML or JSON object.'), { category: 'invalid_input', code: 'command_input_file_invalid' });
		delete input.body.file;
		Object.assign(input.body, parsed);
	}
	for (const binding of deferred) if (input[binding.target][binding.field] === undefined) {
		throw Object.assign(new Error(`Missing required ${binding.source}: ${binding.name}`), { category: 'ambiguous_context', code: `${binding.name}_required` });
	}
	const body = Object.keys(input.body).length
		? input.body
		: operation.schema.body.safeParse(undefined).success ? undefined : {};
	return { operation, input: { ...input, body } };
}

export async function runOperator(invocation: ParsedInvocation, context: CommandContext) {
	const execution = invocation.command.execution;
	if (execution.kind === 'unavailable') throw Object.assign(new Error(execution.reason), { category: 'policy_blocked', code: execution.code });
	if (execution.kind !== 'operation') throw Object.assign(new Error(`No CLI handler is installed for ${execution.handlerId}.`), { category: 'policy_blocked', code: 'local_handler_unavailable' });
	const { operation, input } = await operationInput(invocation, context);
	if (operation.descriptor.operationId === 'communications.send' && !input.body?.message) return runInteractiveChat(invocation, context, String(input.path.teamId), typeof input.path.channel === 'string' ? input.path.channel : undefined);
	if (operation.descriptor.operationId === 'communications.send') {
		const message = String(input.body?.message ?? '');
		const addresses = parseCommunicationAddresses(message);
		if (!addresses.length) throw Object.assign(new Error('Address at least one team agent in the message.'), { category: 'invalid_input', code: 'communication_recipient_required' });
		const compatibility = Array.isArray(invocation.options.to) ? invocation.options.to.map(String) : invocation.options.to ? [String(invocation.options.to)] : [];
		const mentioned = new Set(addresses.flatMap((address) => [address.agentSlug, address.projectSlug ? `${address.projectSlug}/${address.agentSlug}` : '', address.address.slice(1)]).filter(Boolean));
		for (const target of compatibility) if (!mentioned.has(target.replace(/^@/u, '').toLowerCase())) throw Object.assign(
			new Error(`Deprecated --to target ${target} is not addressed in the message.`), { category: 'invalid_input', code: 'communication_to_not_mentioned' });
		if (input.body) input.body.recipients = compatibility.length ? compatibility : undefined;
	}
	if (invocation.options.plan === true) return { operationId: operation.descriptor.operationId, input, mutation: false };
	if (context.operationInvoke) return context.operationInvoke(operation.descriptor.operationId, input);
	const { client, profile } = await createControlPlaneClient(invocation, context, operation.descriptor.authentication !== 'anonymous');
	const options = operation.descriptor.kind === 'mutation' ? { idempotencyKey: randomUUID(), headers: {} as Record<string, string> } : { headers: {} as Record<string, string> };
	if (operation.descriptor.concurrency.required && input.body?.version !== undefined) {
		options.headers[operation.descriptor.concurrency.writeHeader] = `"${String(input.body.version)}"`;
	}
	if (operation.descriptor.concurrency.required && !options.headers[operation.descriptor.concurrency.writeHeader]) {
		const reads: Record<string, string> = {
			'providers.registration.code.rotate': 'providers.registration.code.status',
			'providers.environment.grants.put': 'providers.environment.grants.show',
			'providers.environment.grants.revoke': 'providers.environment.grants.show',
		};
		const readId = reads[operation.descriptor.operationId];
		if (readId) {
			let evidence: { meta?: Record<string, unknown> } | null = null;
			try { evidence = await client.invoke(controlPlaneOperation(readId), { path: input.path, query: {}, body: undefined }); }
			catch (error) {
				if (!(error instanceof ControlPlaneClientError) || error.status !== 404 || operation.descriptor.operationId !== 'providers.environment.grants.put') throw error;
			}
			const value = evidence?.meta?.etag;
			if (typeof value === 'string' && value) options.headers[operation.descriptor.concurrency.writeHeader] = value;
			else if (!evidence && operation.descriptor.operationId === 'providers.environment.grants.put') options.headers[operation.descriptor.concurrency.writeHeader] = 'new';
			else throw Object.assign(new Error('The control plane did not return exact concurrency evidence for this mutation.'), { category: 'stale_preflight', code: 'concurrency_evidence_missing' });
		}
	}
	const invokeAuthorized = async (target: ReturnType<typeof controlPlaneOperation>, targetInput: { path: Record<string, unknown>; query: Record<string, unknown>; body?: Record<string, unknown> }) => {
		const targetOptions = { idempotencyKey: randomUUID(), headers: {} as Record<string, string> };
		try { return await client.invoke(target, targetInput, targetOptions); }
		catch (error) {
			const required = error instanceof ControlPlaneClientError ? error.problem.inputRequired : undefined;
			if (!required || invocation.options.yes !== true) throw error;
			targetOptions.headers['x-treeseed-confirmation'] = encodeConfirmationState(required.confirmation);
			return client.invoke(target, targetInput, targetOptions);
		}
	};
	const completeSeedProviderEnrollment = async (response: unknown, value: Record<string, unknown>) => {
		if (!['seeds.apply', 'seeds.reconcile'].includes(operation.descriptor.operationId)) return response;
		const result = value.result && typeof value.result === 'object' && !Array.isArray(value.result) ? value.result as Record<string, unknown> : {};
		const closure = result.providerClosure && typeof result.providerClosure === 'object' && !Array.isArray(result.providerClosure) ? result.providerClosure as Record<string, unknown> : {};
		const receipts = Array.isArray(closure.receipts) ? closure.receipts.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)) : [];
		const enrollments = receipts.filter((entry) => entry.status === 'enrollment_required');
		if (!enrollments.length) return response;
		if (!context.providerEnrollmentHandoff) throw Object.assign(new Error('The seeded local provider requires the protected host enrollment handoff.'), { category: 'provider_unavailable', code: 'provider_enrollment_handoff_unavailable' });
		for (const enrollment of enrollments) {
			if (enrollment.approval !== 'trusted-local-owner' || typeof enrollment.enrollmentToken !== 'string' || typeof enrollment.teamId !== 'string' || typeof enrollment.connectionId !== 'string') {
				throw Object.assign(new Error('The seeded provider enrollment receipt is incomplete or not trusted-local-owner.'), { category: 'provider_unavailable', code: 'seed_provider_enrollment_invalid' });
			}
			const begun = await context.providerEnrollmentHandoff({ action: 'begin', ...enrollment,
				controlPlaneUrl: profile.baseUrl, controlPlaneAudience: profile.baseUrl, serverProfile: profile.serverId });
			const requestId = typeof begun.requestId === 'string' ? begun.requestId : null;
			if (!requestId) throw Object.assign(new Error('The local provider did not return a registration request for automatic seed approval.'), { category: 'provider_unavailable', code: 'seed_provider_registration_missing' });
			await invokeAuthorized(controlPlaneOperation('providers.requests.approve'), {
				path: { teamId: enrollment.teamId, requestId }, query: {}, body: { teamAlias: enrollment.key },
			});
			await context.providerEnrollmentHandoff({ action: 'complete', connectionId: enrollment.connectionId });
		}
		const timeoutSeconds = Math.max(10, Math.min(600, Number(context.env.TREESEED_SEED_PROVIDER_TIMEOUT_SECONDS ?? 120) || 120));
		const deadline = Date.now() + timeoutSeconds * 1_000;
		const reconcile = controlPlaneOperation('seeds.reconcile');
		while (Date.now() < deadline) {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(1_000, Math.max(1, deadline - Date.now()))));
			const observed = await invokeAuthorized(reconcile, input);
			const observedValue = recordData(observed as Record<string, unknown>);
			const observedResult = observedValue.result && typeof observedValue.result === 'object' && !Array.isArray(observedValue.result) ? observedValue.result as Record<string, unknown> : {};
			const observedClosure = observedResult.providerClosure && typeof observedResult.providerClosure === 'object' && !Array.isArray(observedResult.providerClosure) ? observedResult.providerClosure as Record<string, unknown> : {};
			if (observedClosure.status === 'verified') return observed;
		}
		throw Object.assign(new Error(`The seeded capacity provider did not become execution-ready within ${timeoutSeconds} seconds.`), { category: 'provider_unavailable', code: 'seed_provider_readiness_timeout' });
	};
	const finalize = async (response: unknown) => {
		const envelope = response && typeof response === 'object' ? response as Record<string, unknown> : {};
		const value = envelope.data && typeof envelope.data === 'object'
			? envelope.data as Record<string, unknown>
			: envelope;
		if (['seeds.apply', 'seeds.reconcile'].includes(operation.descriptor.operationId)) return completeSeedProviderEnrollment(response, value);
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
	const waitForCommunication = async (response: unknown) => {
		if (operation.descriptor.operationId !== 'communications.send') return response;
		if (invocation.options.noWait === true) return response;
		const configured = invocation.options.wait ?? invocation.options.timeout;
		const seconds = configured === undefined ? null : Math.max(0, Math.min(3_600, Number(configured) || 0));
		if (seconds === 0) return response;
		const initial = response && typeof response === 'object' ? response as Record<string, unknown> : {};
		let value = recordData(initial); const sendId = typeof value.sendId === 'string' ? value.sendId : '';
		const teamId = typeof input.path.teamId === 'string' ? input.path.teamId : '';
		if (!sendId || !teamId) return response;
		const displayed = new Set<string>();
		const display = (current: Record<string, unknown>) => {
			if (context.outputFormat !== 'human' || invocation.options.jsonStream === true) return;
			const fresh = (Array.isArray(current.responses) ? current.responses : []).filter((candidate) => {
				const item = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
				const key = `${String(item.projectId ?? '')}/${String(item.invocationId ?? '')}`;
				if (displayed.has(key)) return false; displayed.add(key); return true;
			});
			if (fresh.length) context.write(renderCommunicationResponses({ ...current, responses: fresh }, {
				color: Boolean(process.stdout.isTTY && !context.env.NO_COLOR), width: Number(context.env.COLUMNS) || process.stdout.columns || 100,
			}), 'stdout');
		};
		display(value);
		if (invocation.options.jsonStream === true) for (const event of (Array.isArray(value.events) ? value.events : [])) {
			const item = event && typeof event === 'object' ? event as Record<string, unknown> : {}; const key = String(item.id ?? '');
			if (key && !displayed.has(`event:${key}`)) { displayed.add(`event:${key}`); context.write(JSON.stringify({ schemaVersion: 'treeseed.communication-event/v1', event: item }), 'stdout'); }
		}
		const statusOperation = controlPlaneOperation('communications.sends.show'); const deadline = seconds === null ? null : Date.now() + seconds * 1_000;
		while ((deadline === null || Date.now() < deadline) && !['complete', 'partial', 'failed'].includes(String(value.status))) {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, deadline === null ? 1_000 : Math.min(1_000, Math.max(1, deadline - Date.now()))));
			// Chat sessions may outlive the short-lived OAuth access token. Recreate
			// the client at each long poll so server custody can refresh it without
			// interrupting the topic stream.
			const { client: pollingClient } = await createControlPlaneClient(invocation, context, true);
			const observed = await pollingClient.invoke(statusOperation, { path: { teamId, sendId }, query: { diagnostics: invocation.options.diagnostics }, body: undefined });
			value = recordData(observed as unknown as Record<string, unknown>);
			if (invocation.options.jsonStream === true) for (const event of (Array.isArray(value.events) ? value.events : [])) {
				const item = event && typeof event === 'object' ? event as Record<string, unknown> : {}; const key = String(item.id ?? '');
				if (key && !displayed.has(`event:${key}`)) { displayed.add(`event:${key}`); context.write(JSON.stringify({ schemaVersion: 'treeseed.communication-event/v1', event: item }), 'stdout'); }
			}
			display(value);
		}
		if (!['complete', 'partial', 'failed'].includes(String(value.status))) throw Object.assign(
			new Error(`Communication send did not finish within ${seconds} seconds.`), { category: 'provider_unavailable', code: 'communication_wait_timeout', partialResult: value });
		if (invocation.options.jsonStream === true) context.write(JSON.stringify({ schemaVersion: 'treeseed.communication-stream-complete/v1', result: value }), 'stdout');
		return { data: context.outputFormat === 'human' ? { ...value, humanStreamed: true } : value };
	};
	try {
		return await finalize(await waitForCommunication(await client.invoke(operation, input, options)));
	} catch (error) {
		const required = error instanceof ControlPlaneClientError ? error.problem.inputRequired : undefined;
		if (!required) throw error;
		const approved = invocation.options.yes === true || (context.interactiveUi && context.confirm ? await context.confirm(required.prompt, 'no') : false);
		if (!approved) throw Object.assign(new Error(required.prompt), { category: 'confirmation_required', code: 'confirmation_required' });
		options.headers['x-treeseed-confirmation'] = encodeConfirmationState(required.confirmation);
		return finalize(await waitForCommunication(await client.invoke(operation, input, options)));
	}
}

function recordData(value: Record<string, unknown>) {
	return value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data as Record<string, unknown> : value;
}
