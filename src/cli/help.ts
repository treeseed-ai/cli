import { findTreeseedOperation, listTreeseedOperationNames, TRESEED_OPERATION_SPECS } from './operations-registry.ts';
import type {
	TreeseedCommandGroup,
	TreeseedCommandHelpDetail,
	TreeseedCommandRelatedDetail,
	TreeseedOperationSpec,
	TreeseedStructuredCommandExample,
} from './operations-types.ts';

const GROUP_ORDER: TreeseedCommandGroup[] = [
	'Workflow',
	'Local Development',
	'Validation',
	'Release Utilities',
	'Utilities',
	'Passthrough',
];

export type TreeseedHelpEntryAccent = 'command' | 'flag' | 'argument' | 'example' | 'alias' | 'related';

export type TreeseedHelpEntry = {
	label: string;
	summary?: string;
	accent?: TreeseedHelpEntryAccent;
	required?: boolean;
	targetCommand?: string;
};

export type TreeseedHelpSection = {
	id: string;
	title: string;
	entries?: TreeseedHelpEntry[];
	lines?: string[];
};

export type TreeseedHelpView = {
	kind: 'top' | 'command' | 'unknown';
	title: string;
	subtitle?: string;
	badge?: string;
	sidebarTitle: string;
	sections: TreeseedHelpSection[];
	statusPrimary: string;
	statusSecondary: string;
	exitCode: number;
};

function formatExecutionMode(spec: TreeseedOperationSpec) {
	switch (spec.executionMode) {
		case 'handler':
			return 'cli handler';
		case 'adapter':
			return 'sdk adapter';
		case 'delegate':
			return `delegated to ${spec.delegateTo ?? 'runtime'}`;
		default:
			return spec.executionMode;
	}
}

function formatOptionSummary(spec: TreeseedOperationSpec, flags: string, description: string) {
	const option = (spec.options ?? []).find((candidate) => candidate.flags === flags);
	if (!option) {
		return description;
	}
	const traits: string[] = [];
	if (option.kind === 'enum' && (option.values?.length ?? 0) > 0) {
		traits.push(`values: ${(option.values ?? []).join(', ')}`);
	}
	if (option.repeatable) {
		traits.push('repeatable');
	}
	if (traits.length === 0) {
		return description;
	}
	return `${description} (${traits.join('; ')})`;
}

function automationNotes(spec: TreeseedOperationSpec) {
	if ((spec.help?.automationNotes?.length ?? 0) > 0) {
		return spec.help?.automationNotes ?? [];
	}
	const lines = [
		`Execution path: ${formatExecutionMode(spec)}.`,
		`Provider: ${spec.provider}.`,
	];
	if ((spec.options ?? []).some((option) => option.name === 'json')) {
		lines.push('Machine use: supports --json output for scripts and agents.');
	} else {
		lines.push('Machine use: human-oriented command with no dedicated --json surface.');
	}
	return lines;
}

function normalizeStructuredExamples(spec: TreeseedOperationSpec): TreeseedStructuredCommandExample[] {
	if ((spec.help?.examples?.length ?? 0) > 0) {
		return spec.help?.examples ?? [];
	}
	return (spec.examples ?? []).map((entry, index) => typeof entry === 'string'
		? {
			command: entry,
			title: `Example ${index + 1}`,
			description: `Run ${spec.name} with a representative argument set.`,
		}
		: entry);
}

function detailMap(details: TreeseedCommandHelpDetail[] | undefined) {
	return new Map((details ?? []).map((entry) => [entry.name, entry.detail]));
}

function relatedMap(details: TreeseedCommandRelatedDetail[] | undefined) {
	return new Map((details ?? []).map((entry) => [entry.name, entry.why]));
}

function commandSectionEntries(spec: TreeseedOperationSpec): TreeseedHelpEntry[] {
	const entries: TreeseedHelpEntry[] = [
		{ label: 'Command path', summary: `treeseed ${spec.name}` },
		{ label: 'Group', summary: spec.group },
		{ label: 'Workflow position', summary: spec.help?.workflowPosition ?? 'general' },
		{ label: 'Execution', summary: formatExecutionMode(spec) },
		{ label: 'Provider', summary: spec.provider },
		{ label: 'Aliases', summary: spec.aliases.length > 0 ? spec.aliases.join(', ') : 'none' },
	];
	return entries;
}

function exampleEntries(spec: TreeseedOperationSpec): TreeseedHelpEntry[] {
	return normalizeStructuredExamples(spec).flatMap((entry) => [
		{
			label: entry.command,
			summary: `${entry.title}: ${entry.description}`,
			accent: 'example',
		},
		...(entry.result ? [{ label: 'Result', summary: entry.result }] : []),
		...(entry.why ? [{ label: 'Why', summary: entry.why }] : []),
	]);
}

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
		if (spec.helpVisible === false) continue;
		const entries = groups.get(spec.group) ?? [];
		entries.push(spec);
		groups.set(spec.group, entries);
	}
	for (const entries of groups.values()) {
		entries.sort((left, right) => left.name.localeCompare(right.name));
	}
	return groups;
}

function specEntries(specs: TreeseedOperationSpec[]): TreeseedHelpEntry[] {
	return specs.map((spec) => ({
		label: spec.name,
		summary: spec.help?.workflowPosition ? `${spec.help.workflowPosition} • ${spec.summary}` : spec.summary,
		accent: 'command',
		targetCommand: spec.name,
	}));
}

function sectionLines(lines: string[] | undefined) {
	return (lines ?? []).filter((line) => line.trim().length > 0);
}

function entryLines(entries: TreeseedHelpEntry[]) {
	if (entries.length === 0) {
		return [];
	}
	const labelWidth = Math.max(
		0,
		Math.min(
			28,
			entries.reduce((max, entry) => Math.max(max, entry.label.length), 0),
		),
	);
	return entries.map((entry) => {
		if (!entry.summary) {
			return `  ${entry.label}`;
		}
		const spacer = entry.label.length < labelWidth ? ' '.repeat(labelWidth - entry.label.length) : ' ';
		return `  ${entry.label}${spacer} ${entry.summary}`;
	});
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

export function buildTreeseedHelpView(commandName?: string | null): TreeseedHelpView {
	if (!commandName) {
		const groups = groupedCommands();
		const featuredCommands = TRESEED_OPERATION_SPECS
			.filter((spec) => spec.helpVisible !== false && spec.helpFeatured)
			.sort((left, right) => left.name.localeCompare(right.name));
		const sections: TreeseedHelpSection[] = [];
		if (featuredCommands.length > 0) {
			sections.push({
				id: 'featured',
				title: 'Featured Commands',
				entries: specEntries(featuredCommands),
			});
		}
		for (const group of GROUP_ORDER) {
			const entries = groups.get(group) ?? [];
			if (entries.length === 0) continue;
			sections.push({
				id: `group:${group}`,
				title: group,
				entries: specEntries(entries),
			});
		}
		sections.push({
			id: 'help',
			title: 'Help',
			lines: [
				'treeseed --help',
				'treeseed help <command>',
				'treeseed <command> --help',
			],
		});
		sections.push({
			id: 'notes',
			title: 'Notes',
			lines: [
				'Workspace-only commands must be run inside a Treeseed workspace; the CLI resolves the project root from ancestor directories when possible.',
				'Help text is generated from the CLI command registry.',
				'Use --json on supported workflow and utility commands when an AI agent or script needs machine-readable output.',
			],
		});
		return {
			kind: 'top',
			title: 'Treeseed CLI',
			subtitle: 'Command surface over the Treeseed SDK workflow operations, local adapters, and delegated runtime namespaces.',
			badge: `${listTreeseedOperationNames().length} commands`,
			sidebarTitle: 'Sections',
			sections,
			statusPrimary: 'Up/Down selects a section. PgUp/PgDn scroll. Enter, q, or Esc exits help.',
			statusSecondary: 'All commands, groups, and summaries are derived from the registry.',
			exitCode: 0,
		};
	}

	const spec = findTreeseedOperation(commandName);
	if (!spec) {
		const suggestions = suggestTreeseedCommands(commandName);
		return {
			kind: 'unknown',
			title: `Unknown treeseed command: ${commandName}`,
			subtitle: suggestions.length > 0
				? `Closest matches: ${suggestions.map((item) => `\`${item}\``).join(', ')}`
				: 'No close registry matches were found.',
			badge: 'Unknown command',
			sidebarTitle: 'Next Steps',
			sections: [
				...(suggestions.length > 0
					? [{
						id: 'suggestions',
						title: 'Suggestions',
						entries: suggestions.map((item) => ({ label: item, summary: 'View this command help.', accent: 'command' as const, targetCommand: item })),
					}]
					: []),
				{
					id: 'help',
					title: 'Help',
					lines: ['Run `treeseed help` to see the full command list.'],
				},
			],
			statusPrimary: 'Enter, q, or Esc exits help.',
			statusSecondary: 'Unknown-command suggestions come from the same registry used by parsing and execution.',
			exitCode: 1,
		};
	}

	const sections: TreeseedHelpSection[] = [
		...((spec.help?.longSummary?.length ?? 0) > 0 || spec.description
			? [{
				id: 'overview',
				title: 'Overview',
				lines: spec.help?.longSummary ?? [spec.description ?? spec.summary],
			} satisfies TreeseedHelpSection]
			: []),
		...((spec.help?.whenToUse?.length ?? 0) > 0
			? [{
				id: 'when-to-use',
				title: 'When To Use',
				lines: spec.help?.whenToUse ?? [],
			} satisfies TreeseedHelpSection]
			: []),
		...((spec.help?.beforeYouRun?.length ?? 0) > 0
			? [{
				id: 'before-you-run',
				title: 'Before You Run',
				lines: spec.help?.beforeYouRun ?? [],
			} satisfies TreeseedHelpSection]
			: []),
		{
			id: 'command',
			title: 'Command',
			entries: commandSectionEntries(spec),
		},
		{
			id: 'usage',
			title: 'Usage',
			lines: [renderUsage(spec)],
		},
	];
	if ((spec.arguments ?? []).length > 0) {
		const argumentDetails = detailMap(spec.help?.argumentDetails);
		sections.push({
			id: 'arguments',
			title: 'Arguments',
			entries: (spec.arguments ?? []).map((arg) => ({
				label: arg.required ? `<${arg.name}>` : `[${arg.name}]`,
				summary: `${arg.description} (${arg.required ? 'required' : 'optional'})${argumentDetails.get(arg.name) ? ` ${argumentDetails.get(arg.name)}` : ''}`,
				accent: 'argument',
				required: arg.required,
			})),
		});
	} else {
		sections.push({
			id: 'arguments',
			title: 'Arguments',
			lines: ['This command does not take positional arguments.'],
		});
	}
	if ((spec.options ?? []).length > 0) {
		const optionDetails = detailMap(spec.help?.optionDetails);
		sections.push({
			id: 'options',
			title: 'Options',
			entries: (spec.options ?? []).map((option) => ({
				label: option.flags,
				summary: `${formatOptionSummary(spec, option.flags, option.description)}${optionDetails.get(option.flags) ? ` ${optionDetails.get(option.flags)}` : ''}`,
				accent: 'flag',
			})),
		});
	} else {
		sections.push({
			id: 'options',
			title: 'Options',
			lines: ['This command does not define CLI options.'],
		});
	}
	if (spec.aliases.length > 0) {
		sections.push({
			id: 'aliases',
			title: 'Aliases',
			entries: spec.aliases.map((alias) => ({ label: alias, accent: 'alias', targetCommand: alias })),
		});
	}
	if (normalizeStructuredExamples(spec).length > 0) {
		sections.push({
			id: 'examples',
			title: 'Examples',
			entries: exampleEntries(spec),
		});
	}
	if ((spec.help?.outcomes?.length ?? 0) > 0 || (spec.notes?.length ?? 0) > 0) {
		sections.push({
			id: 'behavior',
			title: 'Behavior',
			lines: [...(spec.help?.outcomes ?? []), ...(spec.notes ?? [])],
		});
	}
	sections.push({
		id: 'automation',
		title: 'Automation',
		lines: automationNotes(spec),
	});
	if ((spec.help?.warnings?.length ?? 0) > 0) {
		sections.push({
			id: 'warnings',
			title: 'Warnings',
			lines: spec.help?.warnings ?? [],
		});
	}
	if ((spec.related ?? []).length > 0) {
		const relatedDetails = relatedMap(spec.help?.relatedDetails);
		sections.push({
			id: 'related',
			title: 'Related',
			entries: (spec.related ?? []).map((related) => ({
				label: related,
				summary: relatedDetails.get(related) ?? 'Related command.',
				accent: 'related',
				targetCommand: related,
			})),
		});
	}
	if ((spec.help?.seeAlso?.length ?? 0) > 0) {
		sections.push({
			id: 'see-also',
			title: 'See Also',
			entries: (spec.help?.seeAlso ?? [])
				.filter((name, index, entries) => entries.indexOf(name) === index && !spec.related.includes(name))
				.map((name) => ({
					label: name,
					summary: `Additional next step from the ${spec.name} reference surface.`,
					accent: 'related' as const,
					targetCommand: name,
				})),
		});
	}

	return {
		kind: 'command',
		title: `${spec.name}  ${spec.summary}`,
		subtitle: spec.help?.workflowPosition ? `${spec.group} • ${spec.help.workflowPosition}` : spec.group,
		badge: spec.provider,
		sidebarTitle: spec.name,
		sections,
		statusPrimary: 'Up/Down selects a section. PgUp/PgDn scroll. Enter opens linked commands. b/[ goes back. f/] goes forward.',
		statusSecondary: 'This view is generated from the same command registry used by parsing and execution.',
		exitCode: 0,
	};
}

export function renderTreeseedHelp(commandName?: string | null) {
	const view = buildTreeseedHelpView(commandName);
	const sections = [
		view.title,
		view.subtitle ?? '',
		'',
		...view.sections.flatMap((section) => {
			const lines = [
				...entryLines(section.entries ?? []),
				...sectionLines(section.lines).map((line) => `  ${line}`),
			];
			return lines.length > 0 ? [formatSection(section.title, lines), ''] : [];
		}),
	].filter(Boolean);

	return sections.join('\n').trimEnd();
}
