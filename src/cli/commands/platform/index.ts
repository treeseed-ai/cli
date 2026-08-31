import { resolve } from 'node:path';
import { applyPlatformWorkset, loadPlatformInventory, loadPlatformProfiles, planPlatformWorkset, resolveProfileProjects, verifyPlatformRepository } from '@treeseed/sdk/platform';
import type { CommandContext, ParsedInvocation } from '../../types.js';

const values = (value: string | string[] | boolean | undefined) => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const invalid = (code: string, message: string) => Object.assign(new Error(message), { category: 'invalid_input', code });

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

function projectCreate(invocation: ParsedInvocation) {
	const slug = invocation.arguments[0]!;
	const template = String(invocation.options.template ?? '');
	if (!template) throw invalid('template_required', '--template is required.');
	if (invocation.options.plan === true) return {
		schemaVersion: 'treeseed.platform-project-create-preview/v1', slug, template,
		steps: ['project', 'repository', 'template', 'library', 'inventory'], mutation: false,
		blockers: ['control_plane_project_reconciliation_not_published'],
	};
	throw Object.assign(new Error('Project creation apply remains fail-closed until its control-plane reconciliation operation is published.'), { category: 'policy_blocked', code: 'control_plane_project_reconciliation_not_published' });
}

export function runPlatform(invocation: ParsedInvocation, context: CommandContext) {
	if (invocation.command.name === 'platform verify') return verify(invocation, context);
	if (invocation.command.name === 'platform workset') return workset(invocation, context);
	if (invocation.command.name === 'platform project create') return projectCreate(invocation);
	throw invalid('platform_command_unknown', `Unsupported Platform command ${invocation.command.name}.`);
}
