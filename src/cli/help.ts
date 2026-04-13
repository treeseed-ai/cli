import { findTreeseedOperation, listTreeseedOperationNames, TRESEED_OPERATION_SPECS } from './operations-registry.ts';
import type { TreeseedCommandGroup, TreeseedOperationSpec } from './operations-types.ts';

const GROUP_ORDER: TreeseedCommandGroup[] = [
	'Workflow',
	'Local Development',
	'Validation',
	'Release Utilities',
	'Utilities',
	'Passthrough',
];

function levenshtein(left: string, right: string) {
	const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
	for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
	for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
	for (let i = 1; i <= left.length; i += 1) {
		for (let j = 1; j <= right.length; j += 1) {
			const cost = left[i - 1] === right[j - 1] ? 0 : 1;
			rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
		}
	}
	return rows[left.length][right.length];
}

function formatSection(title: string, lines: string[]) {
	if (lines.length === 0) return '';
	return `${title}\n${lines.join('\n')}`;
}

function groupedCommands() {
	const groups = new Map<TreeseedCommandGroup, TreeseedOperationSpec[]>();
	for (const group of GROUP_ORDER) groups.set(group, []);
	for (const spec of TRESEED_OPERATION_SPECS) {
		const entries = groups.get(spec.group) ?? [];
		entries.push(spec);
		groups.set(spec.group, entries);
	}
	return groups;
}

export function renderUsage(spec: TreeseedOperationSpec) {
	if (spec.usage) return spec.usage;
	const args = (spec.arguments ?? []).map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`));
	const options = (spec.options ?? []).map((option) => (option.repeatable ? `[${option.flags}]...` : `[${option.flags}]`));
	return ['treeseed', spec.name, ...args, ...options].join(' ').replace(/\s+/gu, ' ').trim();
}

export function suggestTreeseedCommands(input: string) {
	const normalized = input.trim().toLowerCase();
	if (!normalized) return [];
	return listTreeseedOperationNames()
		.map((name) => ({ name, score: levenshtein(normalized, name) }))
		.sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
		.slice(0, 3)
		.map((entry) => entry.name);
}

export function renderTreeseedHelp(commandName?: string | null) {
	if (!commandName) {
		const groups = groupedCommands();
		const primaryWorkflow = ['init', 'status', 'config', 'tasks', 'switch', 'dev', 'save', 'close', 'stage', 'release', 'destroy']
			.map((name) => findTreeseedOperation(name))
			.filter((spec): spec is TreeseedOperationSpec => Boolean(spec));
		const workflowGuidance = ['doctor', 'rollback']
			.map((name) => findTreeseedOperation(name))
			.filter((spec): spec is TreeseedOperationSpec => Boolean(spec));

		const sections = [
			'Treeseed CLI',
			'Thin command wrapper over the Treeseed SDK workflow/operations surface plus the agent runtime namespace.',
			'',
			'Usage',
			'  treeseed <command> [args...]',
			'  treeseed help [command]',
			'',
			formatSection('Primary Workflow', primaryWorkflow.map((command) => {
				const spacer = command.name.length < 18 ? ' '.repeat(18 - command.name.length) : ' ';
				return `  ${command.name}${spacer}${command.summary}`;
			})),
			'',
			formatSection('Workflow Support', workflowGuidance.map((command) => {
				const spacer = command.name.length < 18 ? ' '.repeat(18 - command.name.length) : ' ';
				return `  ${command.name}${spacer}${command.summary}`;
			})),
			'',
			...GROUP_ORDER
				.filter((group) => group !== 'Workflow')
				.map((group) => formatSection(group, (groups.get(group) ?? []).map((command) => {
					const spacer = command.name.length < 18 ? ' '.repeat(18 - command.name.length) : ' ';
					return `  ${command.name}${spacer}${command.summary}`;
				})))
				.filter(Boolean),
			'',
			formatSection('Common Flows', [
				'  treeseed status',
				'  treeseed config',
				'  treeseed switch feature/my-change --preview',
				'  treeseed dev',
				'  treeseed save "feat: describe your change"',
				'  treeseed stage "feat: describe the resolution"',
				'  treeseed release --patch',
			]),
			'',
			formatSection('Help', [
				'  treeseed --help',
				'  treeseed help stage',
				'  treeseed stage --help',
				'  treeseed agents --help',
			]),
			'',
			'Notes',
			'  - Workspace-only commands must be run inside a Treeseed workspace; the CLI will resolve the project root from ancestor directories when possible.',
			'  - Use `treeseed status`, `treeseed config`, `treeseed switch`, `treeseed save`, `treeseed stage`, and `treeseed release` for development and release work.',
			'  - Use `treeseed close "reason"` to archive a task without merging; it creates a deprecated resurrection tag before deleting the branch.',
			'  - Use `treeseed agents <command>` for agent runtime inspection and execution.',
			'  - Use `--json` on guidance and main workflow commands when an AI agent or script needs machine-readable output.',
		];

		return sections.filter(Boolean).join('\n');
	}

	if (commandName === 'agents') {
		return [
			'agents  Run the Treeseed agent runtime namespace.',
			'',
			'Usage',
			'  treeseed agents <command>',
			'  treeseed agents --help',
			'',
			'Notes',
			'  - Delegates to the integrated `@treeseed/core` agent runtime.',
			'  - Use `treeseed agents --help` to list supported agent subcommands.',
		].join('\n');
	}

	const spec = findTreeseedOperation(commandName);
	if (!spec) {
		const suggestions = suggestTreeseedCommands(commandName);
		const lines = [`Unknown treeseed command: ${commandName}`];
		if (suggestions.length > 0) {
			lines.push(`Did you mean: ${suggestions.map((item) => `\`${item}\``).join(', ')}?`);
		}
		lines.push('Run `treeseed help` to see the full command list.');
		return lines.join('\n');
	}

	const formatOptions = (spec.options ?? []).map((option) => {
		const spacer = option.flags.length < 28 ? ' '.repeat(28 - option.flags.length) : ' ';
		return `  ${option.flags}${spacer}${option.description}`;
	});
	const formatArguments = (spec.arguments ?? []).map((arg) => {
		const rendered = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
		return `  ${rendered}  ${arg.description}`;
	});

	const sections = [
		`${spec.name}  ${spec.summary}`,
		spec.description,
		'',
		formatSection('Usage', [`  ${renderUsage(spec)}`]),
		formatArguments.length > 0 ? `\n${formatSection('Arguments', formatArguments)}` : '',
		formatOptions.length > 0 ? `\n${formatSection('Options', formatOptions)}` : '',
		(spec.examples ?? []).length > 0 ? `\n${formatSection('Examples', spec.examples.map((example) => `  ${example}`))}` : '',
		(spec.notes ?? []).length > 0 ? `\n${formatSection('Notes', spec.notes.map((note) => `  - ${note}`))}` : '',
		(spec.related ?? []).length > 0 ? `\nRelated: ${spec.related.map((item) => `\`${item}\``).join(', ')}` : '',
	];

	return sections.filter(Boolean).join('\n');
}
