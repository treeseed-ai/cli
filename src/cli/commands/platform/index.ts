import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { applyPlatformWorkset, loadPlatformInventory, loadPlatformProfiles, planPlatformWorkset, projectCreatePlanSchema, resolveProfileProjects, verifyPlatformRepository } from '@treeseed/sdk/platform';
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import { compileHostedTopologyTemplate, hostedTopologyApprovalSchema, hostedTopologyArtifactInputsSchema, hostedTopologyDeclarationSchema, hostedTopologyPlanSchema, hostedTopologyRollbackExecutionApprovalSchema, hostedTopologyRollbackExecutionSchema, hostedTopologyTemplateSchema } from '@treeseed/sdk/deployment';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { createControlPlaneClient } from '../../support/client.js';
import { completeHostedTopologyOperation } from './hosted-vault.js';

const values = (value: string | string[] | boolean | undefined) => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const invalid = (code: string, message: string) => Object.assign(new Error(message), { category: 'invalid_input', code });
const payload = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) && 'data' in value ? (value as { data: unknown }).data : value;

function rootFor(invocation: ParsedInvocation, context: CommandContext) {
	return resolve(context.cwd, invocation.arguments[0] ?? '.');
}

function verify(invocation: ParsedInvocation, context: CommandContext) {
	const root = rootFor(invocation, context);
	const profiles = loadPlatformProfiles(root);
	const selected = values(invocation.options.profile);
	if (selected.length) resolveProfileProjects(profiles, selected);
	const result = { ...verifyPlatformRepository(root), profiles: selected };
	if (!result.ok) throw Object.assign(new Error('Platform repository verification failed.'), {
		category: 'policy_blocked', code: 'platform_verification_failed', partialResult: result,
	});
	return result;
}

function workset(invocation: ParsedInvocation, context: CommandContext) {
	const planning = invocation.options.plan === true;
	const applying = invocation.options.apply === true;
	if (planning === applying) throw invalid('workset_mode_required', 'Choose exactly one of --plan or --apply.');
	if (applying && invocation.options.yes !== true) throw Object.assign(new Error('Workset application requires --yes after reviewing the plan.'), { category: 'confirmation_required', code: 'confirmation_required' });
	const loaded = loadPlatformInventory(context.cwd);
	const profiles = loadPlatformProfiles(context.cwd);
	const plan = planPlatformWorkset({ root: loaded.root, inventoryPath: loaded.path, inventoryDigest: loaded.digest, inventory: loaded.inventory, profiles, selection: {
		profiles: values(invocation.options.profile),
		projects: values(invocation.options.project),
		exclude: values(invocation.options.exclude),
	} });
	if (planning) return plan;
	return applyPlatformWorkset(plan);
}

function templateLock(root: string, id: string) {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw invalid('template_invalid', 'Template identities use portable lowercase slugs.');
	const path = resolve(root, 'templates', `${id}.yaml`);
	const value = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
	const artifact = value.artifact && typeof value.artifact === 'object' ? value.artifact as Record<string, unknown> : {};
	const version = String(value.version ?? ''); const digest = String(artifact.digest ?? '');
	if (value.schemaVersion !== 'treeseed.platform-template-lock/v1' || value.id !== id || !version || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
		throw invalid('template_lock_invalid', `Template lock ${path} is not an exact published template.`);
	}
	return { id, version, digest };
}

async function projectCreate(invocation: ParsedInvocation, context: CommandContext) {
	const slug = invocation.arguments[0]!;
	const templateId = String(invocation.options.template ?? '');
	if (!templateId) throw invalid('template_required', '--template is required.');
	const planning = invocation.options.plan === true; const applying = invocation.options.apply === true;
	if (planning === applying) throw invalid('project_create_mode_required', 'Choose exactly one of --plan or --apply.');
	if (applying && invocation.options.yes !== true) throw Object.assign(new Error('Project creation apply requires --yes after reviewing the plan.'), { category: 'confirmation_required', code: 'confirmation_required' });
	const template = templateLock(context.cwd, templateId);
	let teamId = String(context.env.TREESEED_TEAM_ID ?? ''); let invoke: (body: Record<string, unknown>, apply: boolean) => Promise<unknown>;
	if (context.operationInvoke) invoke = (body) => context.operationInvoke!('projects.create', { path: { teamId }, query: {}, body }, { idempotencyKey: randomUUID() });
	else {
		const { client, session } = await createControlPlaneClient(invocation, context, true); teamId = String(session?.activeTeam?.id ?? '');
		invoke = (body) => client.invoke(CONTROL_PLANE_OPERATIONS.projects.create, { path: { teamId }, query: {}, body }, { idempotencyKey: randomUUID(), headers: {} });
	}
	if (!teamId) throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before creating a project.'), { category: 'ambiguous_context', code: 'active_team_required' });
	const plan = projectCreatePlanSchema.parse(payload(await invoke({ mode: 'plan', target: { slug, template, repository: { name: slug, visibility: 'private' } } }, false)));
	if (planning) return plan;
	if (!plan.ok) throw Object.assign(new Error('Project creation is blocked by conflicting remote authority.'), { category: 'policy_blocked', code: 'platform_project_create_blocked', partialResult: plan });
	return payload(await invoke({ mode: 'apply', plan }, true));
}

function document(path: string, context: CommandContext) {
	try { return parseYaml(readFileSync(resolve(context.cwd, path), 'utf8')); }
	catch (error) { throw invalid('topology_document_invalid', `Unable to read topology document ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function templatePlatformCommit(path: string, context: CommandContext) {
	try {
		const root = execFileSync('git', ['-C', context.cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
		const target = resolve(context.cwd, path), relativePath = relative(root, target).replaceAll('\\', '/');
		if (!relativePath || relativePath.startsWith('../')) throw new Error('Template is outside the Platform Git worktree.');
		execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', relativePath], { stdio: 'ignore' });
		const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '--', relativePath], { encoding: 'utf8' }).trim();
		if (status) throw new Error('Template differs from the exact Platform commit.');
		return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch (error) { throw invalid('topology_template_custody_invalid', error instanceof Error ? error.message : String(error)); }
}

async function topology(invocation: ParsedInvocation, context: CommandContext) {
	const injected = context.operationInvoke;
	let teamId = String(context.env.TREESEED_TEAM_ID ?? ''), invoke: (operation: any, input: unknown, mutation?: boolean) => Promise<unknown>;
	if (injected) invoke = (operation, input) => injected(operation.descriptor.operationId, input);
	else {
		const { client, session } = await createControlPlaneClient(invocation, context, true);
		teamId = String(session?.activeTeam?.id ?? '');
		invoke = (operation, input: any, mutation = false) => client.invoke(operation, input, mutation ? { idempotencyKey: randomUUID(), headers: {} } : undefined);
	}
	if (!teamId) throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before managing hosted topology.'), { category: 'ambiguous_context', code: 'active_team_required' });
	const operations = CONTROL_PLANE_OPERATIONS.infrastructure.topology;
	if (invocation.command.name === 'platform topology plan') {
		const path = invocation.arguments[0]!, source = document(path, context) as Record<string, unknown>, artifactPath = String(invocation.options.artifacts ?? '');
		let declaration;
		if (source.schemaVersion === 'treeseed.hosted-topology-template/v1') {
			if (!artifactPath) throw invalid('topology_artifacts_required', '--artifacts is required for a hosted topology template.');
			declaration = compileHostedTopologyTemplate({ template: hostedTopologyTemplateSchema.parse(source), teamId, platformCommit: templatePlatformCommit(path, context), artifacts: hostedTopologyArtifactInputsSchema.parse(document(artifactPath, context)).artifacts });
		} else {
			if (artifactPath) throw invalid('topology_artifacts_unexpected', '--artifacts is accepted only with a hosted topology template.');
			declaration = hostedTopologyDeclarationSchema.parse(source);
		}
		if (declaration.teamId !== teamId) throw invalid('topology_team_mismatch', 'The hosted topology declaration is not bound to the active team.');
		return completeHostedTopologyOperation(await invoke(operations.plan, { path: { teamId }, query: {}, body: { declaration } }), teamId, invoke, context);
	}
	if (invocation.command.name === 'platform topology status') return payload(await invoke(operations.status, { path: { teamId }, query: {}, body: undefined }));
	if (invocation.options.yes !== true) throw Object.assign(new Error('Hosted topology mutation requires --yes after reviewing the exact plan and approval.'), { category: 'confirmation_required', code: 'confirmation_required' });
	const approvalPath = String(invocation.options.approval ?? '');
	if (!approvalPath) throw invalid('topology_approval_required', '--approval is required.');
	if (invocation.command.name === 'platform topology apply') {
		const plan = hostedTopologyPlanSchema.parse(document(invocation.arguments[0]!, context));
		const approval = hostedTopologyApprovalSchema.parse(document(approvalPath, context));
		if (plan.teamId !== teamId || approval.teamId !== teamId) throw invalid('topology_team_mismatch', 'The hosted topology plan and approval must be bound to the active team.');
		return completeHostedTopologyOperation(await invoke(operations.apply, { path: { teamId }, query: {}, body: { plan, approval } }, true), teamId, invoke, context);
	}
	const rollbackBundle = document(invocation.arguments[0]!, context) as Record<string, unknown>;
	const execution = hostedTopologyRollbackExecutionSchema.parse(rollbackBundle.execution);
	const sourcePlan = hostedTopologyPlanSchema.parse(rollbackBundle.sourcePlan);
	const targetPlan = hostedTopologyPlanSchema.parse(rollbackBundle.targetPlan);
	const approval = hostedTopologyRollbackExecutionApprovalSchema.parse(document(approvalPath, context));
	if (execution.teamId !== teamId || sourcePlan.teamId !== teamId || targetPlan.teamId !== teamId || approval.teamId !== teamId)
		throw invalid('topology_team_mismatch', 'The hosted topology rollback closure and approval must be bound to the active team.');
	return completeHostedTopologyOperation(await invoke(operations.rollback, { path: { teamId }, query: {},
		body: { execution, approval, sourcePlan, targetPlan } }, true), teamId, invoke, context);
}

export function runPlatform(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name === 'platform verify') return verify(invocation, context);
	if (invocation.command.name === 'platform workset') return workset(invocation, context);
	if (invocation.command.name === 'platform project create') return projectCreate(invocation, context);
	if (invocation.command.name.startsWith('platform topology ')) return topology(invocation, context);
	throw invalid('platform_command_unknown', `Unsupported Platform command ${invocation.command.name}.`);
}
