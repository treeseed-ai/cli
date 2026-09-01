import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { applyPlatformWorkset, loadPlatformInventory, loadPlatformProfiles, planPlatformWorkset, projectCreatePlanSchema, resolveProfileProjects, verifyPlatformRepository } from '@treeseed/sdk/platform';
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';
import type { CommandContext, ParsedInvocation } from '../../types.js';
import { createControlPlaneClient } from '../../support/client.js';

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
	if (context.operationInvoke) invoke = (body) => context.operationInvoke!('projects.create', { path: { teamId }, query: {}, body });
	else {
		const { client, session } = await createControlPlaneClient(invocation, context, true); teamId = String(session?.activeTeam?.id ?? '');
		invoke = (body, apply) => client.invoke(CONTROL_PLANE_OPERATIONS.projects.create, { path: { teamId }, query: {}, body }, apply ? { idempotencyKey: randomUUID(), headers: {} } : undefined);
	}
	if (!teamId) throw Object.assign(new Error('Select an active team with `trsd teams use <team>` before creating a project.'), { category: 'ambiguous_context', code: 'active_team_required' });
	const plan = projectCreatePlanSchema.parse(payload(await invoke({ mode: 'plan', target: { slug, template, repository: { name: slug, visibility: 'private' } } }, false)));
	if (planning) return plan;
	if (!plan.ok) throw Object.assign(new Error('Project creation is blocked by conflicting remote authority.'), { category: 'policy_blocked', code: 'platform_project_create_blocked', partialResult: plan });
	return payload(await invoke({ mode: 'apply', plan }, true));
}

export function runPlatform(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name === 'platform verify') return verify(invocation, context);
	if (invocation.command.name === 'platform workset') return workset(invocation, context);
	if (invocation.command.name === 'platform project create') return projectCreate(invocation, context);
	throw invalid('platform_command_unknown', `Unsupported Platform command ${invocation.command.name}.`);
}
