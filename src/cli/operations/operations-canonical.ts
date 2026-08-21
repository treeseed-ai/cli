import {
	TREESEED_COMMAND_TREE_V1,
	type CommandLeafDescriptor,
	type CommandNodeDescriptor,
} from '@treeseed/sdk/operator-contracts';
import type { CommandOptionSpec, OperationSpec } from './operations-types.ts';

const CONTEXT_OPTIONS: CommandOptionSpec[] = [
	{ name: 'market', flags: '--market <profile>', description: 'Control-plane profile; local uses the managed local API.', kind: 'string' },
	{ name: 'team', flags: '--team <team>', description: 'Team id, slug, or unambiguous workspace team.', kind: 'string' },
	{ name: 'project', flags: '--project <project>', description: 'Project id, slug, or unambiguous workspace project.', kind: 'string' },
	{ name: 'provider', flags: '--provider <provider>', description: 'Capacity provider identity.', kind: 'string' },
	{ name: 'connection', flags: '--connection <connection>', description: 'Provider connection identity.', kind: 'string' },
	{ name: 'registrationKeyRef', flags: '--registration-key-ref <secret-ref>', description: 'One-time provider registration secret reference; never the plaintext secret.', kind: 'string' },
	{ name: 'profile', flags: '--profile <profile>', description: 'Repository-governed workday profile identity.', kind: 'string' },
	{ name: 'decision', flags: '--decision <decision>', description: 'Approved decision identity used to inspect its API-derived plans.', kind: 'string' },
	{ name: 'file', flags: '--file <path>', description: 'Repository-governed profile or provider offer document.', kind: 'string' },
	{ name: 'projects', flags: '--projects <all-or-csv>', description: 'Project scope; use all or a comma-separated list.', kind: 'string' },
	{ name: 'start', flags: '--start <timestamp>', description: 'Workday start time as an ISO timestamp.', kind: 'string' },
	{ name: 'end', flags: '--end <timestamp>', description: 'Workday end time as an ISO timestamp.', kind: 'string' },
	{ name: 'duration', flags: '--duration <seconds>', description: 'Workday duration in seconds.', kind: 'string' },
	{ name: 'objective', flags: '--objective <filter>', description: 'Objective filter; repeat to add filters.', kind: 'string', repeatable: true },
	{ name: 'preflight', flags: '--preflight <id>', description: 'Exact API-issued preflight identity.', kind: 'string' },
	{ name: 'digest', flags: '--digest <sha256>', description: 'Exact API-issued preflight digest.', kind: 'string' },
	{ name: 'reason', flags: '--reason <reason>', description: 'Operator reason recorded with a mutation.', kind: 'string' },
	{ name: 'status', flags: '--status <status>', description: 'Filter a resource listing by status.', kind: 'string' },
	{ name: 'limit', flags: '--limit <count>', description: 'Maximum page size.', kind: 'string' },
	{ name: 'cursor', flags: '--cursor <cursor>', description: 'Opaque pagination cursor.', kind: 'string' },
	{ name: 'yes', flags: '--yes', description: 'Confirm an authorized noninteractive mutation; policy is still enforced.', kind: 'boolean' },
	{ name: 'json', flags: '--json', description: 'Emit the stable command-result JSON envelope.', kind: 'boolean' },
];

function selectedContextOptions(path: string[], leaf: CommandLeafDescriptor) {
	const root = path[0];
	const names = new Set(['json']);
	if (root === 'auth') names.add('market');
	if (root === 'agents') ['market', 'project', 'status', 'limit', 'cursor'].forEach((name) => names.add(name));
	if (root === 'providers') ['market', 'team', 'provider', 'connection', 'registrationKeyRef', 'file', 'reason', 'status', 'limit', 'cursor'].forEach((name) => names.add(name));
	if (root === 'capacity') ['market', 'team', 'project', 'provider', 'status', 'limit', 'cursor'].forEach((name) => names.add(name));
	if (root === 'plans') ['market', 'decision', 'status', 'limit', 'cursor'].forEach((name) => names.add(name));
	if (root === 'workdays') ['market', 'team', 'profile', 'projects', 'start', 'end', 'duration', 'objective', 'preflight', 'digest', 'reason', 'status', 'limit', 'cursor', 'file'].forEach((name) => names.add(name));
	if (root === 'assignments') ['market', 'team', 'project', 'reason', 'status', 'limit', 'cursor'].forEach((name) => names.add(name));
	if (leaf.kind === 'mutation') names.add('yes');
	return CONTEXT_OPTIONS.filter((option) => names.has(option.name));
}

function contractOptions(path: string[], leaf: CommandLeafDescriptor): CommandOptionSpec[] {
	const options = selectedContextOptions(path, leaf);
	for (const option of leaf.options ?? []) {
		if (options.some((candidate) => candidate.flags.split(' ')[0] === option.name)) continue;
		options.push({
			name: option.name.slice(2).replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase()),
			flags: option.type === 'boolean' ? option.name : `${option.name} <value>`,
			description: option.description,
			kind: option.type === 'boolean' ? 'boolean' : 'string',
		});
	}
	return options;
}

const HANDLERS: Record<string, string> = {
	'auth login': 'authLogin', 'auth logout': 'authLogout', 'auth status': 'authWhoAmI',
	'secrets list': 'secretsStatus', 'secrets status': 'secretsStatus', 'secrets unlock': 'secretsUnlock',
	'secrets lock': 'secretsLock', 'secrets rotate': 'secretsRotatePassphrase',
	status: 'status', diagnose: 'doctor',
};

function humanDescription(path: string[], leaf: CommandLeafDescriptor) {
	const name = path.join(' ');
	const exact: Record<string, string> = {
		'workdays plan': 'Ask the API to compile an exact, time-bounded portfolio workday preflight.',
		'workdays start': 'Start a workday from an unchanged API-issued preflight receipt.',
		'capacity explain': 'Explain current allocation, reservation, borrowing, and provider admission state.',
		'plans diff': 'Compare two immutable API-derived capacity plans.',
		'agents validate': 'Validate accepted project agents, one-class membership, and provider compatibility.',
		'agents diff': 'Compare repository agent definitions with the accepted control-plane generation.',
		'agents diagnose': 'Diagnose stale definitions, bindings, classes, and provider compatibility.',
		'providers connect': 'Connect a capacity provider through the private provider runtime and governed API approval flow.',
		'save': 'Verify assignment authority and create or update its draft GitHub pull request.',
		'stage': 'Verify the exact pull-request head and merge an accepted change to staging.',
		'release': 'Promote an accepted staging composition through human-governed production release.',
		'status': 'Show the current workspace, assignment, provider, and workflow state.',
		'diagnose': 'Diagnose workspace, control-plane, provider, and workflow readiness.',
	};
	if (exact[name]) return exact[name];
	const resource = path.slice(0, -1).join(' ') || 'resource';
	const action = path.at(-1)!;
	const verbs: Record<string, string> = {
		list: `List ${resource}.`, show: `Show one ${resource} record.`, explain: `Explain one ${resource} record.`,
		status: `Show ${resource} status.`, validate: `Validate ${resource}.`, diagnose: `Diagnose ${resource}.`,
		watch: `Watch ${resource} state.`, diff: `Compare ${resource}.`, artifacts: `List assignment artifacts.`,
		pause: `Pause ${resource}.`, resume: `Resume ${resource}.`, stop: `Stop ${resource}.`, cancel: `Cancel ${resource}.`,
		start: `Start ${resource}.`, retire: `Retire ${resource}.`, retry: `Retry ${resource}.`,
		approve: `Approve ${resource}.`, reject: `Reject ${resource}.`, revoke: `Revoke ${resource}.`, rotate: `Rotate ${resource}.`,
		lock: `Lock ${resource}.`, unlock: `Unlock ${resource}.`, login: 'Authenticate a human operator.', logout: 'End the current operator session.',
	};
	return verbs[action] ?? leaf.description;
}

function operation(path: string[], leaf: CommandLeafDescriptor): OperationSpec {
	const name = path.join(' ');
	const description = humanDescription(path, leaf);
	return {
		id: `operator.${path.join('.')}` as OperationSpec['id'],
		name,
		group: path.length === 1 ? 'Workflow' : 'Utilities',
		summary: description,
		description,
		provider: 'default',
		related: [],
		usage: `trsd ${name}${(leaf.arguments ?? []).map((argument) => ` <${argument.name}>`).join('')} [options]`,
		arguments: (leaf.arguments ?? []).map((argument) => ({ name: argument.name, description: argument.description, required: argument.required })),
		options: contractOptions(path, leaf),
		examples: [`trsd ${name} --help`, `trsd ${name} --json`],
		helpVisible: true,
		helpFeatured: path.length === 1,
		executionMode: 'handler',
		handlerName: HANDLERS[name] ?? 'operator',
		help: {
			workflowPosition: leaf.kind === 'read' ? 'inspect control-plane state' : 'request a governed mutation',
			longSummary: [description, 'The control-plane API remains authoritative; the CLI only submits high-level intent or reads projections.'],
			whenToUse: [`Use \`trsd ${name}\` for the ${name} operator workflow.`],
			beforeYouRun: ['Select an unambiguous workspace or provide the team/project context shown in help.'],
			outcomes: [leaf.kind === 'read' ? 'Returns an authoritative read projection.' : 'Returns either an exact no-mutation plan or an API mutation receipt.'],
			automationNotes: ['Use --json for the stable SDK command-result envelope. Mutation commands execute by default; --plan guarantees zero mutation.'],
			warnings: leaf.authorization?.confirmation === 'never' ? [] : ['Confirmation may be required. --yes confirms intent but never bypasses API authorization or policy.'],
		},
	};
}

function flatten(nodes: CommandNodeDescriptor[], parent: string[] = []): OperationSpec[] {
	return nodes.flatMap((node) => {
		const path = [...parent, node.segment];
		return node.nodeType === 'leaf' ? [operation(path, node)] : flatten(node.children, path);
	});
}

export const canonicalOperationSpecs = flatten(TREESEED_COMMAND_TREE_V1.commands);
