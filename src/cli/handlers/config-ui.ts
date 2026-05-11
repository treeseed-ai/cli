import { spawnSync } from 'node:child_process';
import { Box, render, Text, useApp, useInput, usePaste, useWindowSize } from 'ink';
import React from 'react';
import {
	AppFrame,
	clampOffset,
	computeViewportLayout,
	EmptyState,
	ensureVisible,
	findClickableRegion,
	PrimaryButton,
	SidebarList,
	type UiClickRegion,
	type UiScrollRegion,
	type UiViewportLayout,
	routeWheelDeltaToScrollRegion,
	ScrollPanel,
	SecondaryButton,
	StatusBar,
	TextInputField,
	formatSecretMaskedValue,
	truncateLine,
	wrapText,
} from '../ui/framework.js';
import { useTerminalMouse } from '../ui/mouse.js';

type ConfigScope = 'local' | 'staging' | 'prod';
export type ConfigViewMode = 'startup' | 'full';
type ConfigFocusArea = 'environment' | 'filter' | 'sidebar' | 'content' | 'actions';
type ConfigValidation =
	| { kind: 'string' | 'nonempty' | 'boolean' | 'number' | 'url' | 'email' }
	| { kind: 'enum'; values: string[] };

type ConfigEntry = {
	id: string;
	label: string;
	group: string;
	cluster: string;
	startupProfile: 'core' | 'optional' | 'advanced';
	requirement: 'required' | 'conditional' | 'optional';
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
	validation?: ConfigValidation;
	scope: Exclude<ConfigScope, 'all'>;
	sharedScopes: Array<Exclude<ConfigScope, 'all'>>;
	required: boolean;
	currentValue: string;
	suggestedValue: string;
	effectiveValue: string;
};

type ConfigContextSnapshot = {
	project: {
		name: string;
		slug: string;
	};
	scopes: Array<Exclude<ConfigScope, 'all'>>;
	entriesByScope: Record<Exclude<ConfigScope, 'all'>, ConfigEntry[]>;
	configReadinessByScope: Record<Exclude<ConfigScope, 'all'>, {
		github: { configured: boolean };
		cloudflare: { configured: boolean };
		railway: { configured: boolean };
		localDevelopment: { configured: boolean };
	}>;
};

export type ConfigPage = {
	kind: 'entry';
	key: string;
	entry: ConfigEntry;
	scope: ConfigScope;
	scopes: ConfigScope[];
	requiredScopes: ConfigScope[];
	required: boolean;
	currentValue: string;
	suggestedValue: string;
	finalValue: string;
	wizardRequiredMissing: boolean;
};

export type ConfigWizardStep = ConfigPage & {
	index: number;
	total: number;
};

export type ConfigEditorResult = {
	overrides: Record<string, string>;
	viewMode: ConfigViewMode;
};

type ConfigCommitUpdate = {
	scope: Exclude<ConfigScope, 'all'>;
	entryId: string;
	value: string;
};

export type ConfigInputState = {
	value: string;
	cursor: number;
};

export type ConfigViewportLayout = UiViewportLayout & {
	sidebarWidth: number;
	contentWidth: number;
	detailHeight: number;
	detailViewportHeight: number;
	inputHeight: number;
	actionRowHeight: number;
};

const FULL_CONFIG_FILTERS: ConfigScope[] = ['local', 'staging', 'prod'];

function firstAvailableScope(context: ConfigContextSnapshot, preferred: ConfigScope = 'local') {
	if (context.scopes.includes(preferred)) {
		return preferred;
	}
	return context.scopes[0] ?? preferred;
}

function maskValue(value: string) {
	if (!value) {
		return '(unset)';
	}
	return formatSecretMaskedValue(value);
}

function scopeOrder(scope: ConfigScope) {
	return ['local', 'staging', 'prod'].indexOf(scope);
}

function providerWorkflowKey(entry: ConfigEntry) {
	const id = entry.id.toUpperCase();
	if (id.startsWith('GH_') || id.includes('GITHUB')) {
		return 'github';
	}
	if (id.startsWith('CLOUDFLARE_') || id.includes('TURNSTILE') || entry.group === 'cloudflare') {
		return 'cloudflare';
	}
	if (id.startsWith('RAILWAY_') || entry.group === 'railway') {
		return 'railway';
	}
	if (entry.group === 'local-development') {
		return 'local-development';
	}
	if (entry.group === 'forms') {
		return 'forms';
	}
	if (entry.group === 'smtp') {
		return 'smtp';
	}
	if (entry.group === 'auth') {
		return 'auth-core';
	}
	return entry.group;
}

function providerWorkflowRank(entry: ConfigEntry) {
	const order = ['auth-core', 'github', 'cloudflare', 'railway', 'local-development', 'forms', 'smtp'];
	const index = order.indexOf(providerWorkflowKey(entry));
	return index === -1 ? order.length : index;
}

function normalizedClusterKey(entry: ConfigEntry) {
	const provider = providerWorkflowKey(entry);
	const cluster = entry.cluster.trim().toLowerCase();
	if (provider === 'cloudflare') {
		if (entry.id.includes('API_TOKEN') || entry.id.includes('ACCOUNT_ID')) {
			return 'cloudflare-account';
		}
		if (entry.id.includes('TURNSTILE') || cluster.includes('turnstile')) {
			return 'cloudflare-turnstile';
		}
		return `cloudflare-${cluster}`;
	}
	if (provider === 'railway') {
		if (entry.id.includes('API_TOKEN')) {
			return 'railway-access';
		}
		return `railway-${cluster}`;
	}
	return `${provider}-${cluster}`;
}

function resolveFirstNonEmptyValue(
	scopes: ConfigScope[],
	entriesByScope: ConfigContextSnapshot['entriesByScope'],
	entryId: string,
	field: 'currentValue' | 'suggestedValue' | 'effectiveValue',
) {
	for (const scope of scopes) {
		const entry = entriesByScope[scope].find((candidate) => candidate.id === entryId);
		const value = entry?.[field];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return '';
}

function resolveSharedEntryValue(
	relevantScopes: ConfigScope[],
	requiredScopes: ConfigScope[],
	entriesByScope: ConfigContextSnapshot['entriesByScope'],
	entryId: string,
	field: 'currentValue' | 'suggestedValue' | 'effectiveValue',
	options: { fallbackToRelevant?: boolean } = {},
) {
	const preferredScopes = requiredScopes.length > 0 ? requiredScopes : relevantScopes;
	const preferredValue = resolveFirstNonEmptyValue(preferredScopes, entriesByScope, entryId, field);
	if (preferredValue.length > 0) {
		return preferredValue;
	}
	if (options.fallbackToRelevant === false) {
		return '';
	}
	return resolveFirstNonEmptyValue(relevantScopes, entriesByScope, entryId, field);
}

export function resolveCurrentConfigValue(
	context: ConfigContextSnapshot,
	overrides: Record<string, string>,
	entryId: string,
	scope: ConfigScope = 'local',
) {
	const sharedOverrideKey = `shared:${entryId}`;
	if (sharedOverrideKey in overrides) {
		return overrides[sharedOverrideKey] ?? '';
	}
	const scopedOverrideKey = `${scope}:${entryId}`;
	if (scopedOverrideKey in overrides) {
		return overrides[scopedOverrideKey] ?? '';
	}
	for (const candidateScope of [scope, ...context.scopes.filter((candidate) => candidate !== scope)]) {
		const entry = context.entriesByScope[candidateScope]?.find((candidate) => candidate.id === entryId);
		if (entry?.storage === 'shared') {
			const overrideKey = `shared:${entryId}`;
			if (overrideKey in overrides) {
				return overrides[overrideKey] ?? '';
			}
		}
		if (typeof entry?.currentValue === 'string' && entry.currentValue.length > 0) {
			return entry.currentValue;
		}
	}
	return '';
}

function hasUsableValue(value: string) {
	return typeof value === 'string' && value.trim().length > 0;
}

function isConfigValueValid(entry: ConfigEntry, value: string) {
	if (!hasUsableValue(value)) {
		return false;
	}
	if (!entry.validation) {
		return true;
	}
	switch (entry.validation.kind) {
		case 'string':
		case 'nonempty':
			return value.trim().length > 0
				&& (
					typeof entry.validation.minLength !== 'number'
					|| value.trim().length >= entry.validation.minLength
				);
		case 'boolean':
			return /^(true|false|1|0)$/i.test(value);
		case 'number':
			return Number.isFinite(Number(value));
		case 'url':
			try {
				new URL(value);
				return true;
			} catch {
				return false;
			}
		case 'email':
			return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
		case 'enum':
			return entry.validation.values.includes(value);
		default:
			return true;
	}
}

function isWizardRequiredMissing(page: Omit<ConfigPage, 'wizardRequiredMissing'>) {
	if (page.requiredScopes.length === 0) {
		return false;
	}
	return !isConfigValueValid(page.entry, page.finalValue);
}

function startupPriority(page: ConfigPage) {
	if (page.required) {
		return 0;
	}
	if (page.wizardRequiredMissing) {
		return 1;
	}
	return 2;
}

function formatDisplayValue(page: ConfigPage, value: string, emptyLabel: string) {
	if (!hasUsableValue(value)) {
		return emptyLabel;
	}
	return page.entry.sensitivity === 'secret' ? maskValue(value) : value;
}

export function filterCliConfigPages(pages: ConfigPage[], query: string) {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return pages;
	}
	return pages.filter((page) =>
		[
			page.entry.id,
			page.entry.label,
			page.entry.group,
			page.entry.cluster,
			page.scope,
		].some((field) => field.toLowerCase().includes(normalizedQuery)),
	);
}

function tabRects(prefix: string, items: string[], selectedIndex: number, y: number, startX: number) {
	let x = startX + prefix.length;
	return items.map((item, index) => {
		const label = index === selectedIndex ? `[${item}]` : item;
		const rect = { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: label.length, height: 1 };
		x += label.length + 1;
		return { item, rect };
	});
}

function buttonLabel(label: string) {
	return `[ ${label} ]`;
}

function buttonRects(labels: string[], y: number, startX: number) {
	let x = startX;
	return labels.map((label) => {
		const rendered = buttonLabel(label);
		const rect = { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: rendered.length, height: 1 };
		x += rendered.length + 1;
		return { label, rect };
	});
}

export function computeConfigViewportLayout(rows: number, columns: number): ConfigViewportLayout {
	const layout = computeViewportLayout(rows, columns, { topBarHeight: 3, footerHeight: 2 });
	const sidebarWidth = Math.max(22, Math.min(34, Math.floor(layout.columns * 0.28)));
	const contentWidth = Math.max(34, layout.columns - sidebarWidth - 1);
	const actionRowHeight = 1;
	const inputHeight = 4;
	const detailHeight = Math.max(4, layout.bodyHeight - inputHeight - actionRowHeight);
	return {
		...layout,
		sidebarWidth,
		contentWidth,
		detailHeight,
		detailViewportHeight: detailHeight,
		inputHeight,
		actionRowHeight,
	};
}

export function buildCliConfigPages(
	context: ConfigContextSnapshot,
	selectedFilter: ConfigScope,
	overrides: Record<string, string> = {},
	viewMode: ConfigViewMode = 'startup',
) {
	const selectedScopes = viewMode === 'startup'
		? context.scopes
		: context.scopes.filter((scope) => scope === selectedFilter);
	const sharedEntries = new Set<string>();
	const pages: ConfigPage[] = [];

	for (const scope of selectedScopes) {
		for (const entry of context.entriesByScope[scope] ?? []) {
			if (entry.storage === 'shared') {
				if (sharedEntries.has(entry.id)) {
					continue;
				}
				const relevantScopes = selectedScopes.filter((candidateScope) => context.entriesByScope[candidateScope]?.some((candidate) => candidate.id === entry.id));
				const key = `shared:${entry.id}`;
				sharedEntries.add(entry.id);
				const requiredScopes = relevantScopes.filter((candidateScope) => context.entriesByScope[candidateScope]?.some((candidate) => candidate.id === entry.id && candidate.required));
				const currentValue = resolveSharedEntryValue(relevantScopes, requiredScopes, context.entriesByScope, entry.id, 'currentValue');
				const suggestedValue = resolveSharedEntryValue(relevantScopes, requiredScopes, context.entriesByScope, entry.id, 'suggestedValue', {
					fallbackToRelevant: requiredScopes.length === 0,
				});
				const effectiveValue = resolveSharedEntryValue(relevantScopes, requiredScopes, context.entriesByScope, entry.id, 'effectiveValue', {
					fallbackToRelevant: requiredScopes.length === 0,
				});
				const candidatePage = {
					kind: 'entry' as const,
					key,
					entry,
					scope,
					scopes: relevantScopes,
					requiredScopes,
					required: requiredScopes.length > 0,
					currentValue,
					suggestedValue,
					finalValue: resolveEntryPageFinalValue(key, {
						...entry,
						currentValue,
						suggestedValue,
						effectiveValue,
					}, overrides),
				};
				pages.push({
					...candidatePage,
					wizardRequiredMissing: isWizardRequiredMissing(candidatePage),
				});
				continue;
			}

			const key = `${scope}:${entry.id}`;
			const candidatePage = {
				kind: 'entry' as const,
				key,
				entry,
				scope,
				scopes: [scope],
				requiredScopes: entry.required ? [scope] : [],
				required: entry.required,
				currentValue: entry.currentValue,
				suggestedValue: entry.suggestedValue,
				finalValue: resolveEntryPageFinalValue(key, entry, overrides),
			};
			pages.push({
				...candidatePage,
				wizardRequiredMissing: isWizardRequiredMissing(candidatePage),
			});
		}
	}

	const orderedPages = pages.sort((left, right) => {
		if (startupPriority(left) !== startupPriority(right)) {
			return startupPriority(left) - startupPriority(right);
		}
		if (left.entry.startupProfile !== right.entry.startupProfile) {
			const order = { core: 0, optional: 1, advanced: 2 };
			return order[left.entry.startupProfile] - order[right.entry.startupProfile];
		}
		if (providerWorkflowRank(left.entry) !== providerWorkflowRank(right.entry)) {
			return providerWorkflowRank(left.entry) - providerWorkflowRank(right.entry);
		}
		if (normalizedClusterKey(left.entry) !== normalizedClusterKey(right.entry)) {
			return normalizedClusterKey(left.entry).localeCompare(normalizedClusterKey(right.entry));
		}
		if (left.entry.storage !== right.entry.storage) {
			return left.entry.storage === 'shared' ? -1 : 1;
		}
		if (left.scope !== right.scope) {
			return scopeOrder(left.scope) - scopeOrder(right.scope);
		}
		if (left.entry.purposes.length !== right.entry.purposes.length) {
			return right.entry.purposes.length - left.entry.purposes.length;
		}
		return left.entry.label.localeCompare(right.entry.label);
	});

	return viewMode === 'startup'
		? orderedPages.filter((page) => page.wizardRequiredMissing)
		: orderedPages;
}

function buildStartupDetailLines(step: ConfigWizardStep | null, draftValue: string) {
	if (!step) {
		return ['No startup configuration is required for the selected environment set.'];
	}
	return [
		`${step.entry.label} (${step.entry.id})`,
		`Applies to: ${step.scopes.join(', ')}`,
		`Required in: ${step.requiredScopes.join(', ')}`,
		`Storage: ${step.entry.storage}`,
		'',
		`Current value: ${formatDisplayValue(step, step.currentValue, '(unset)')}`,
		`Suggested value: ${formatDisplayValue(step, step.suggestedValue, '(none)')}`,
		`Pending value: ${formatDisplayValue(step, draftValue, '(unset)')}`,
		'',
		step.entry.description || 'Treeseed needs this value to complete setup.',
		'',
		'How to get it:',
		...(step.entry.howToGet || 'Use the suggested/default value if it matches your setup.').split('\n'),
	];
}

function buildFullDetailLines(page: ConfigPage | null, draftValue: string) {
	if (!page) {
		return ['No configuration entries match the selected environment filter.'];
	}
	return [
		`${page.entry.label} (${page.entry.id})`,
		`Scope: ${page.scopes.join(', ')}`,
		`Storage: ${page.entry.storage} | ${page.required ? 'required' : 'optional'}`,
		`Group: ${page.entry.group}`,
		'',
		`Current: ${formatDisplayValue(page, page.currentValue, '(unset)')}`,
		`Suggested: ${formatDisplayValue(page, page.suggestedValue, '(none)')}`,
		`Pending: ${formatDisplayValue(page, draftValue, '(unset)')}`,
		'',
		page.entry.description || '(no description)',
		'',
		'How to get it:',
		...(page.entry.howToGet || '(no extra setup guidance)').split('\n'),
	];
}

function detailViewportLines(lines: string[], width: number, height: number, offset: number) {
	const wrapped = lines.flatMap((line) => wrapText(line, Math.max(1, width - 2)));
	const viewportSize = Math.max(1, height - 4);
	const safeOffset = clampOffset(offset, wrapped.length, viewportSize);
	return {
		lines: wrapped.slice(safeOffset, safeOffset + viewportSize),
		offset: safeOffset,
		total: wrapped.length,
		viewportSize,
	};
}

function nextDraftValue(page: ConfigPage | null, drafts: Record<string, string>) {
	if (!page) {
		return '';
	}
	return page.key in drafts ? drafts[page.key] : page.finalValue;
}

function resolveEntryPageFinalValue(pageKey: string, entry: ConfigEntry, overrides: Record<string, string>) {
	if (pageKey in overrides) {
		return overrides[pageKey]!;
	}
	return entry.effectiveValue || entry.suggestedValue || entry.currentValue || '';
}

function insertAt(value: string, insert: string, cursor: number) {
	return `${value.slice(0, cursor)}${insert}${value.slice(cursor)}`;
}

function deleteBackward(value: string, cursor: number) {
	if (cursor <= 0) {
		return { value, cursor };
	}
	return {
		value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`,
		cursor: cursor - 1,
	};
}

function deleteForward(value: string, cursor: number) {
	if (cursor >= value.length) {
		return { value, cursor };
	}
	return {
		value: `${value.slice(0, cursor)}${value.slice(cursor + 1)}`,
		cursor,
	};
}

function cycleFocus(current: ConfigFocusArea, viewMode: ConfigViewMode) {
	const areas: ConfigFocusArea[] = viewMode === 'startup'
		? ['content', 'actions']
		: ['environment', 'filter', 'sidebar', 'content', 'actions'];
	const index = areas.indexOf(current);
	return areas[(index + 1) % areas.length] ?? 'content';
}

export function normalizeConfigInputChunk(input: string) {
	if (!input) {
		return '';
	}
	return input
		.replace(/\u001b\[200~/gu, '')
		.replace(/\u001b\[201~/gu, '')
		.replace(/\r\n/gu, '\n')
		.replace(/\r/gu, '\n')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
		.replace(/\n+$/gu, '');
}

export function applyConfigInputInsertion(state: ConfigInputState, input: string): ConfigInputState {
	const normalized = normalizeConfigInputChunk(input);
	if (!normalized) {
		return state;
	}
	return {
		value: insertAt(state.value, normalized, state.cursor),
		cursor: state.cursor + normalized.length,
	};
}

function runClipboardCommand(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 1500,
	});
	if (result.status !== 0) {
		return null;
	}
	const text = String(result.stdout ?? '').replace(/\r\n/gu, '\n');
	return text.length > 0 ? text : null;
}

export function readLinuxClipboardText() {
	if (process.platform !== 'linux') {
		return null;
	}
	return runClipboardCommand('wl-paste', ['--no-newline'])
		?? runClipboardCommand('xclip', ['-selection', 'clipboard', '-o'])
		?? runClipboardCommand('xsel', ['--clipboard', '--output']);
}

function isCtrlVPaste(input: string, key: { ctrl?: boolean }) {
	return (key.ctrl && input === 'v') || input === '\u0016';
}

export async function runCliConfigEditor(
	context: ConfigContextSnapshot,
	options: {
		initialViewMode?: ConfigViewMode;
		mouseEnabled?: boolean;
		initialStatusMessage?: string;
		toolAvailability?: {
			githubCli?: { available: boolean };
			wranglerCli?: { available: boolean };
			railwayCli?: { available: boolean };
			ghActExtension?: { available: boolean };
			dockerDaemon?: { available: boolean };
		};
		secretSession?: {
			status?: { unlocked?: boolean };
			createdWrappedKey?: boolean;
			migratedWrappedKey?: boolean;
			unlockSource?: string;
		};
		onCommit?: (update: ConfigCommitUpdate) => Promise<ConfigContextSnapshot> | ConfigContextSnapshot;
	} = {},
) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return null;
	}

	return await new Promise<ConfigEditorResult | null>((resolveSession) => {
		let finished = false;
		let instance: ReturnType<typeof render> | undefined;

		const finish = (result: ConfigEditorResult | null) => {
			if (finished) {
				return;
			}
			finished = true;
			instance?.unmount();
			resolveSession(result);
		};

		function App() {
			const sidebarFilterHeight = 4;
			const [currentContext, setCurrentContext] = React.useState(context);
			const [filterIndex, setFilterIndex] = React.useState(() => {
				const initialScope = firstAvailableScope(context);
				return Math.max(0, FULL_CONFIG_FILTERS.indexOf(initialScope));
			});
			const [viewMode, setViewMode] = React.useState<ConfigViewMode>(options.initialViewMode ?? 'startup');
			const [pageIndex, setPageIndex] = React.useState(0);
			const [sidebarOffset, setSidebarOffset] = React.useState(0);
			const [detailOffset, setDetailOffset] = React.useState(0);
			const [drafts, setDrafts] = React.useState<Record<string, string>>({});
			const [cursorPositions, setCursorPositions] = React.useState<Record<string, number>>({});
			const [overrides, setOverrides] = React.useState<Record<string, string>>({});
			const [filterQuery, setFilterQuery] = React.useState('');
			const [filterCursor, setFilterCursor] = React.useState(0);
			const [focusArea, setFocusArea] = React.useState<ConfigFocusArea>(options.initialViewMode === 'full' ? 'filter' : 'content');
			const [actionIndex, setActionIndex] = React.useState(0);
			const [saving, setSaving] = React.useState(false);
			const [statusMessage, setStatusMessage] = React.useState(
				options.initialStatusMessage
					?? (options.initialViewMode === 'full'
					? 'Full editor ready. Filter the variable list or edit the selected value.'
					: 'Startup wizard ready. Update each required value in order.'),
			);
			const { exit } = useApp();
			const windowSize = useWindowSize();
			const layout = computeConfigViewportLayout(windowSize?.rows ?? 24, windowSize?.columns ?? 100);
			const selectedFilter = FULL_CONFIG_FILTERS[filterIndex] ?? firstAvailableScope(currentContext);
			const readinessScope = firstAvailableScope(currentContext, selectedFilter);
			const allPages = buildCliConfigPages(currentContext, selectedFilter, overrides, viewMode);
			const pages = viewMode === 'full' ? filterCliConfigPages(allPages, filterQuery) : allPages;
			const safePageIndex = pages.length === 0 ? 0 : Math.min(pageIndex, pages.length - 1);
			const selectedPage = pages[safePageIndex] ?? null;
			const draftValue = nextDraftValue(selectedPage, drafts);
			const cursorPosition = selectedPage ? Math.max(0, Math.min(cursorPositions[selectedPage.key] ?? draftValue.length, draftValue.length)) : 0;
			const focusAreaRef = React.useRef<ConfigFocusArea>(focusArea);
			const viewModeRef = React.useRef<ConfigViewMode>(viewMode);
			const selectedPageRef = React.useRef<ConfigPage | null>(selectedPage);
			const draftValueRef = React.useRef(draftValue);
			const cursorPositionRef = React.useRef(cursorPosition);
			const filterQueryRef = React.useRef(filterQuery);
			const filterCursorRef = React.useRef(filterCursor);
			focusAreaRef.current = focusArea;
			viewModeRef.current = viewMode;
			selectedPageRef.current = selectedPage;
			draftValueRef.current = draftValue;
			cursorPositionRef.current = cursorPosition;
			filterQueryRef.current = filterQuery;
			filterCursorRef.current = filterCursor;
			const startupStep = selectedPage ? { ...selectedPage, index: safePageIndex, total: pages.length } : null;
			const detailSourceLines = viewMode === 'startup'
				? buildStartupDetailLines(startupStep, draftValue)
				: buildFullDetailLines(selectedPage, draftValue);
			const detailWidth = viewMode === 'full' ? layout.contentWidth : layout.columns;
			const detailPanel = detailViewportLines(detailSourceLines, detailWidth, layout.detailHeight, detailOffset);
			const configReadiness = {
				github: { configured: hasUsableValue(resolveCurrentConfigValue(currentContext, overrides, 'GH_TOKEN', readinessScope)) },
				cloudflare: { configured: hasUsableValue(resolveCurrentConfigValue(currentContext, overrides, 'CLOUDFLARE_API_TOKEN', readinessScope)) },
				railway: { configured: hasUsableValue(resolveCurrentConfigValue(currentContext, overrides, 'RAILWAY_API_TOKEN', readinessScope)) },
				localDevelopment: currentContext.configReadinessByScope[readinessScope]?.localDevelopment ?? { configured: true },
			};
			const sidebarHeight = Math.max(4, layout.bodyHeight - sidebarFilterHeight);
			const sidebarViewportSize = Math.max(1, sidebarHeight - 4);
			const safeSidebarOffset = clampOffset(ensureVisible(safePageIndex, sidebarOffset, sidebarViewportSize), pages.length, sidebarViewportSize);
			const visibleSidebar = pages.slice(safeSidebarOffset, safeSidebarOffset + sidebarViewportSize);
			const startupActions = selectedPage
				? ['Back', ...(hasUsableValue(selectedPage?.suggestedValue ?? '') ? ['Use Suggested + Next'] : []), 'Update + Next']
				: [];
			const fullActions = ['Save Value', 'Clear', 'Finish'];
			const actions = viewMode === 'startup' ? startupActions : fullActions;
			const envRects = viewMode === 'full'
				? tabRects('Env ', FULL_CONFIG_FILTERS, filterIndex, 2, 1)
				: [];
			const clickRegions: UiClickRegion[] = [];
			const sidebarRect = { x: 0, y: layout.topBarHeight, width: layout.sidebarWidth, height: layout.bodyHeight };
			const filterRect = { x: 0, y: layout.topBarHeight, width: layout.sidebarWidth, height: sidebarFilterHeight };
			const detailRect = {
				x: viewMode === 'full' ? layout.sidebarWidth + 1 : 0,
				y: layout.topBarHeight,
				width: viewMode === 'full' ? layout.contentWidth : layout.columns,
				height: layout.detailHeight,
			};

			React.useEffect(() => {
				if (safePageIndex !== pageIndex) {
					setPageIndex(safePageIndex);
				}
			}, [pageIndex, safePageIndex]);

			React.useEffect(() => {
				if (safeSidebarOffset !== sidebarOffset) {
					setSidebarOffset(safeSidebarOffset);
				}
			}, [safeSidebarOffset, sidebarOffset]);

			React.useEffect(() => {
				if (detailPanel.offset !== detailOffset) {
					setDetailOffset(detailPanel.offset);
				}
			}, [detailPanel.offset, detailOffset]);

			React.useEffect(() => {
				setActionIndex(0);
			}, [viewMode, selectedPage?.key]);

			React.useEffect(() => {
				setDetailOffset(0);
			}, [selectedPage?.key]);

			React.useEffect(() => {
				if (viewMode === 'startup' && selectedPage) {
					setFocusArea('content');
				}
			}, [selectedPage?.key, viewMode, selectedPage]);

			React.useEffect(() => {
				setPageIndex(0);
				setSidebarOffset(0);
			}, [filterQuery, selectedFilter]);

			React.useEffect(() => {
				if (selectedPage && !(selectedPage.key in cursorPositions)) {
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: draftValue.length }));
				}
			}, [cursorPositions, draftValue.length, selectedPage]);

			React.useEffect(() => {
				setFocusArea(viewMode === 'full' ? 'filter' : 'content');
			}, [viewMode]);

			React.useEffect(() => {
				if (viewMode === 'startup' && pages.length === 0) {
					setViewMode('full');
					setFocusArea('filter');
					setPageIndex(0);
					setFilterIndex(0);
					setFilterQuery('');
					setFilterCursor(0);
					setStatusMessage('Startup configuration is complete. Switched to the full editor.');
				}
			}, [pages.length, viewMode]);

			const finishWithOverrides = React.useCallback((nextOverrides: Record<string, string>) => {
				finish({
					overrides: nextOverrides,
					viewMode,
				});
			}, [viewMode]);

			const advanceStartupFlow = React.useCallback((
				nextOverrides: Record<string, string>,
				currentPageKey: string,
			) => {
				const nextPages = buildCliConfigPages(currentContext, selectedFilter, nextOverrides, 'startup');
				const currentIndex = nextPages.findIndex((page) => page.key === currentPageKey);
				const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
				if (nextIndex >= nextPages.length) {
					setOverrides(nextOverrides);
					setViewMode('full');
					setFocusArea('filter');
					setPageIndex(0);
					setFilterIndex(0);
					setFilterQuery('');
					setFilterCursor(0);
					setDetailOffset(0);
					setStatusMessage('Startup configuration is complete. Switched to the full editor.');
					return;
				}
				setFocusArea('content');
				setPageIndex(nextIndex);
				setDetailOffset(0);
			}, [currentContext, selectedFilter]);

			const commitCurrentDraft = React.useCallback(async (value: string) => {
				if (!selectedPage || !options.onCommit) {
					return true;
				}
				setSaving(true);
				setStatusMessage(`Saving ${selectedPage.entry.id}...`);
				try {
					const refreshedContext = await options.onCommit({
						scope: selectedPage.scope,
						entryId: selectedPage.entry.id,
						value,
					});
					setCurrentContext(refreshedContext);
					setDrafts((current) => ({ ...current, [selectedPage.key]: value }));
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: value.length }));
					setOverrides((current) => {
						const next = { ...current };
						delete next[selectedPage.key];
						return next;
					});
					return true;
				} catch (error) {
					setStatusMessage(error instanceof Error ? error.message : `Unable to save ${selectedPage.entry.id}.`);
					return false;
				} finally {
					setSaving(false);
				}
			}, [options, selectedPage]);

			const saveCurrentDraft = React.useCallback(async (advance: boolean) => {
				if (!selectedPage || saving) {
					return;
				}
				const value = nextDraftValue(selectedPage, drafts);
				const committed = await commitCurrentDraft(value);
				if (!committed) {
					return;
				}
				const nextOverrides = { ...overrides, [selectedPage.key]: value };
				setOverrides(nextOverrides);
				setFocusArea('content');
				setStatusMessage(`Updated ${selectedPage.entry.id}.`);
				if (advance) {
					if (viewMode === 'startup') {
						advanceStartupFlow(nextOverrides, selectedPage.key);
						return;
					}
					setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + 1));
					setDetailOffset(0);
				}
			}, [advanceStartupFlow, commitCurrentDraft, drafts, overrides, pages.length, saving, selectedPage, viewMode]);

			const activateAction = React.useCallback(async (label: string) => {
				if (saving) {
					return;
				}
				if (label === 'Back') {
					setFocusArea('content');
					setPageIndex((current) => Math.max(0, current - 1));
					setDetailOffset(0);
					return;
				}
				if (label === 'Use Suggested + Next' && selectedPage) {
					const suggested = selectedPage.suggestedValue || selectedPage.finalValue;
					setDrafts((current) => ({ ...current, [selectedPage.key]: suggested }));
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: suggested.length }));
					const committed = await commitCurrentDraft(suggested);
					if (!committed) {
						return;
					}
					const nextOverrides = { ...overrides, [selectedPage.key]: suggested };
					setOverrides(nextOverrides);
					setFocusArea('content');
					setStatusMessage(`Accepted suggested value for ${selectedPage.entry.id}.`);
					if (viewMode === 'startup') {
						advanceStartupFlow(nextOverrides, selectedPage.key);
						return;
					}
					setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + 1));
					setDetailOffset(0);
					return;
				}
				if (label === 'Update + Next') {
					void saveCurrentDraft(true);
					return;
				}
				if (label === 'Save Value') {
					void saveCurrentDraft(false);
					return;
				}
				if (label === 'Clear' && selectedPage) {
					setDrafts((current) => ({ ...current, [selectedPage.key]: '' }));
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: 0 }));
					setOverrides((current) => ({ ...current, [selectedPage.key]: '' }));
					setStatusMessage(`Cleared ${selectedPage.entry.id}.`);
					return;
				}
				if (label === 'Finish') {
					finishWithOverrides(overrides);
				}
			}, [advanceStartupFlow, commitCurrentDraft, finishWithOverrides, overrides, saveCurrentDraft, saving, selectedPage, viewMode]);

			const scrollRegions: UiScrollRegion[] = [
				...(viewMode === 'full'
					? [{
						id: 'config-sidebar',
						rect: {
							x: sidebarRect.x,
							y: sidebarRect.y + sidebarFilterHeight,
							width: sidebarRect.width,
							height: sidebarHeight,
						},
						state: {
							offset: safeSidebarOffset,
							viewportSize: sidebarViewportSize,
							totalSize: pages.length,
						},
						onScroll: (offset: number) => {
							setSidebarOffset(offset);
							setPageIndex(Math.min(Math.max(0, pages.length - 1), offset));
						},
						onFocus: () => setFocusArea('sidebar'),
					}]
					: []),
				{
					id: 'config-detail',
					rect: detailRect,
					state: {
						offset: detailPanel.offset,
						viewportSize: detailPanel.viewportSize,
						totalSize: detailPanel.total,
					},
					onScroll: (offset: number) => setDetailOffset(offset),
					onFocus: () => setFocusArea('content'),
				},
			];

			useTerminalMouse((event) => {
				if (event.button === 'scroll-up' || event.button === 'scroll-down') {
					const delta = event.button === 'scroll-up' ? -1 : 1;
					routeWheelDeltaToScrollRegion(scrollRegions, event.x, event.y, delta);
					return;
				}
				if (event.action !== 'release' || event.button !== 'left') {
					return;
				}
				findClickableRegion(clickRegions, event.x, event.y)?.onClick();
			}, { enabled: options.mouseEnabled === true });

			useInput((input, key) => {
				if (key.ctrl && input === 'c') {
					exit();
					finish(null);
					return;
				}

				if (key.tab) {
					setFocusArea((current) => cycleFocus(current, viewMode));
					return;
				}

				if (input === 's' && focusArea !== 'content' && focusArea !== 'filter') {
					if (viewMode === 'startup' && selectedPage) {
						setStatusMessage('Complete each required startup step before saving. Use Update + Next to continue.');
						return;
					}
					finishWithOverrides(overrides);
					return;
				}

				if (focusArea === 'environment') {
					if (viewMode === 'startup') {
						return;
					}
					if (key.leftArrow) {
						setFilterIndex((current) => Math.max(0, current - 1));
						setPageIndex(0);
						return;
					}
					if (key.rightArrow) {
						setFilterIndex((current) => Math.min(FULL_CONFIG_FILTERS.length - 1, current + 1));
						setPageIndex(0);
						return;
					}
				}

				if (focusArea === 'filter' && viewMode === 'full') {
					if (isCtrlVPaste(input, key)) {
						const clipboardText = readLinuxClipboardText();
						if (!clipboardText) {
							setStatusMessage('Ctrl+V clipboard paste is unavailable. Use right-click/menu paste or install wl-paste, xclip, or xsel.');
							return;
						}
						const next = applyConfigInputInsertion({ value: filterQuery, cursor: filterCursor }, clipboardText);
						setFilterQuery(next.value);
						setFilterCursor(next.cursor);
						setStatusMessage('Filtered the variable list from the clipboard.');
						return;
					}
					if (key.home) {
						setFilterCursor(0);
						return;
					}
					if (key.end) {
						setFilterCursor(filterQuery.length);
						return;
					}
					if (key.leftArrow) {
						setFilterCursor((current) => Math.max(0, current - 1));
						return;
					}
					if (key.rightArrow) {
						setFilterCursor((current) => Math.min(filterQuery.length, current + 1));
						return;
					}
					if (key.backspace) {
						const next = deleteBackward(filterQuery, filterCursor);
						setFilterQuery(next.value);
						setFilterCursor(next.cursor);
						return;
					}
					if (key.delete) {
						const next = deleteForward(filterQuery, filterCursor);
						setFilterQuery(next.value);
						setFilterCursor(next.cursor);
						return;
					}
					if (!key.ctrl && !key.meta && input && !key.return && !key.upArrow && !key.downArrow && !key.pageDown && !key.pageUp) {
						const next = applyConfigInputInsertion({ value: filterQuery, cursor: filterCursor }, input);
						setFilterQuery(next.value);
						setFilterCursor(next.cursor);
						return;
					}
				}

				if (focusArea === 'sidebar' && viewMode === 'full') {
					if (key.upArrow) {
						setPageIndex((current) => Math.max(0, current - 1));
						return;
					}
					if (key.downArrow) {
						setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + 1));
						return;
					}
					if (key.pageUp) {
						setPageIndex((current) => Math.max(0, current - sidebarViewportSize));
						return;
					}
					if (key.pageDown) {
						setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + sidebarViewportSize));
						return;
					}
				}

				if (focusArea === 'content') {
					if (selectedPage && isCtrlVPaste(input, key)) {
						const clipboardText = readLinuxClipboardText();
						if (!clipboardText) {
							setStatusMessage('Ctrl+V clipboard paste is unavailable. Use right-click/menu paste or install wl-paste, xclip, or xsel.');
							return;
						}
						const next = applyConfigInputInsertion({ value: draftValue, cursor: cursorPosition }, clipboardText);
						setDrafts((current) => ({ ...current, [selectedPage.key]: next.value }));
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: next.cursor }));
						setStatusMessage(`Pasted text into ${selectedPage.entry.id}.`);
						return;
					}
					if (selectedPage && key.home) {
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: 0 }));
						return;
					}
					if (selectedPage && key.end) {
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: draftValue.length }));
						return;
					}
					if (selectedPage && key.leftArrow) {
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: Math.max(0, cursorPosition - 1) }));
						return;
					}
					if (selectedPage && key.rightArrow) {
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: Math.min(draftValue.length, cursorPosition + 1) }));
						return;
					}
					if (selectedPage && key.backspace) {
						const next = deleteBackward(draftValue, cursorPosition);
						setDrafts((current) => ({ ...current, [selectedPage.key]: next.value }));
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: next.cursor }));
						return;
					}
					if (selectedPage && key.delete) {
						const next = deleteForward(draftValue, cursorPosition);
						setDrafts((current) => ({ ...current, [selectedPage.key]: next.value }));
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: next.cursor }));
						return;
					}
					if (key.pageUp) {
						setDetailOffset((current) => Math.max(0, current - detailPanel.viewportSize));
						return;
					}
					if (key.pageDown) {
						setDetailOffset((current) => current + detailPanel.viewportSize);
						return;
					}
					if (viewMode === 'full' && key.upArrow) {
						setDetailOffset((current) => Math.max(0, current - 1));
						return;
					}
					if (viewMode === 'full' && key.downArrow) {
						setDetailOffset((current) => current + 1);
						return;
					}
					if (selectedPage && key.return && viewMode === 'startup') {
						void saveCurrentDraft(true);
						return;
					}
					if (!key.ctrl && !key.meta && input && selectedPage && !key.upArrow && !key.downArrow && !key.pageDown && !key.pageUp) {
						const next = applyConfigInputInsertion({ value: draftValue, cursor: cursorPosition }, input);
						setDrafts((current) => ({ ...current, [selectedPage.key]: next.value }));
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: next.cursor }));
						return;
					}
				}

				if (focusArea === 'actions') {
					if (key.leftArrow) {
						setActionIndex((current) => Math.max(0, current - 1));
						return;
					}
					if (key.rightArrow) {
						setActionIndex((current) => Math.min(actions.length - 1, current + 1));
						return;
					}
					if (key.return) {
						void activateAction(actions[actionIndex] ?? actions[0] ?? 'Finish');
					}
				}
			});

			usePaste((text) => {
				if (focusAreaRef.current === 'filter' && viewModeRef.current === 'full') {
					const next = applyConfigInputInsertion({ value: filterQueryRef.current, cursor: filterCursorRef.current }, text);
					setFilterQuery(next.value);
					setFilterCursor(next.cursor);
					setStatusMessage('Filtered the variable list.');
					return;
				}
				const currentPage = selectedPageRef.current;
				if (focusAreaRef.current !== 'content' || !currentPage) {
					return;
				}
				const next = applyConfigInputInsertion({ value: draftValueRef.current, cursor: cursorPositionRef.current }, text);
				setDrafts((current) => ({ ...current, [currentPage.key]: next.value }));
				setCursorPositions((current) => ({ ...current, [currentPage.key]: next.cursor }));
				setStatusMessage(`Pasted text into ${currentPage.entry.id}.`);
			}, { isActive: true });

			if (viewMode === 'full') {
				for (const [index, item] of envRects.entries()) {
					clickRegions.push({
						id: `env-${item.item}`,
						rect: item.rect,
						onClick: () => {
							setFilterIndex(index);
							setPageIndex(0);
							setFocusArea('environment');
						},
					});
				}
			}

			clickRegions.push({
				id: 'detail-focus',
				rect: detailRect,
				onClick: () => {
					setFocusArea('content');
				},
			});

			if (viewMode === 'full') {
				clickRegions.push({
					id: 'filter-focus',
					rect: filterRect,
					onClick: () => {
						setFocusArea('filter');
					},
				});
				for (let index = 0; index < visibleSidebar.length; index += 1) {
					const page = visibleSidebar[index];
					if (!page) {
						continue;
					}
					clickRegions.push({
						id: `sidebar-${page.key}`,
						rect: { x: 1, y: layout.topBarHeight + sidebarFilterHeight + 2 + index, width: layout.sidebarWidth - 2, height: 1 },
						onClick: () => {
							setPageIndex(safeSidebarOffset + index);
							setFocusArea('sidebar');
						},
					});
				}
			}

			const actionRects = buttonRects(actions, layout.topBarHeight + layout.detailHeight + layout.inputHeight + 1, viewMode === 'full' ? layout.sidebarWidth + 3 : 2);
			for (const [index, item] of actionRects.entries()) {
				clickRegions.push({
					id: `action-${item.label}`,
					rect: item.rect,
					onClick: () => {
						setFocusArea('actions');
						setActionIndex(index);
						void activateAction(item.label);
					},
				});
			}

			const titleLine = truncateLine(
				`Treeseed Config  ${currentContext.project.name} (${currentContext.project.slug})  GH cfg:${configReadiness.github.configured ? 'ok' : 'miss'}  CF cfg:${configReadiness.cloudflare.configured ? 'ok' : 'miss'}  RW cfg:${configReadiness.railway.configured ? 'ok' : 'miss'}`,
				layout.columns,
			);
			const statusTail = viewMode === 'full'
				? `Env ${selectedFilter}`
				: '';
			const toolsLine = truncateLine(
				`gh:${options.toolAvailability?.githubCli?.available ? 'ok' : 'miss'}  wr:${options.toolAvailability?.wranglerCli?.available ? 'ok' : 'miss'}  rw:${options.toolAvailability?.railwayCli?.available ? 'ok' : 'miss'}  act:${options.toolAvailability?.ghActExtension?.available ? 'ok' : 'miss'}  dk:${options.toolAvailability?.dockerDaemon?.available ? 'ok' : 'miss'}  sec:${options.secretSession?.status?.unlocked ? 'on' : 'off'}${statusTail ? `  ${statusTail}` : ''}`,
				layout.columns,
			);
			const topBar = React.createElement(
				React.Fragment,
				null,
				React.createElement(Text, { color: 'cyan', bold: true }, titleLine),
				React.createElement(Text, { color: 'gray' }, toolsLine),
				viewMode === 'full'
					? React.createElement(Text, { color: focusArea === 'environment' ? 'cyan' : 'gray' }, truncateLine(`Env ${FULL_CONFIG_FILTERS.map((filter) => filter === selectedFilter ? `[${filter}]` : filter).join(' ')}`, layout.columns))
					: React.createElement(Text, { color: 'gray' }, truncateLine(`Wizard mode across ${currentContext.scopes.join(', ')}.`, layout.columns)),
			);

			const footer = React.createElement(StatusBar, {
				width: layout.columns,
				accent: focusArea === 'content',
				primary: viewMode === 'full'
					? `Tab cycles env, filter, list, editor, and actions. Type in Filter to narrow variables. Sidebar arrows${options.mouseEnabled === true ? ' or wheel' : ''} change selection.`
					: `Type or paste to edit. Left/Right move the cursor, Home/End jump, Enter updates and advances.`,
				secondary: statusMessage,
			});

			if (viewMode === 'startup') {
				const body = selectedPage
					? React.createElement(
						Box,
						{ flexDirection: 'column', width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
						React.createElement(ScrollPanel, {
							width: layout.columns,
							height: layout.detailHeight,
							title: startupStep ? `Required Setup  ${Math.max(0, startupStep.total - startupStep.index - 1)} left` : 'Required Setup',
							lines: detailPanel.lines,
							focused: focusArea === 'content',
							tone: 'accent',
							scrollState: {
								offset: detailPanel.offset,
								viewportSize: detailPanel.viewportSize,
								totalSize: detailPanel.total,
							},
						}),
						React.createElement(TextInputField, {
							width: layout.columns,
							height: layout.inputHeight,
							label: 'Value',
							focused: focusArea === 'content',
							value: draftValue,
							cursorPosition,
							secret: selectedPage.entry.sensitivity === 'secret',
							placeholder: '',
							helperText: '',
						}),
						React.createElement(
							Box,
							{ width: layout.columns, height: layout.actionRowHeight },
							...actionRects.map((item, index) => React.createElement(
								item.label === 'Update + Next'
									? PrimaryButton
									: SecondaryButton,
								{
									key: item.label,
									label: item.label,
									focused: focusArea === 'actions' && index === actionIndex,
									width: item.rect.width,
								},
							)),
						),
					)
					: React.createElement(EmptyState, {
						width: layout.columns,
						height: layout.bodyHeight,
						title: 'Required Setup Complete',
						message: 'The required setup flow is complete.',
					});

				return React.createElement(AppFrame, { layout, topBar, body, footer });
			}

			const body = React.createElement(
				Box,
				{ width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
				React.createElement(
					Box,
					{ flexDirection: 'column', width: layout.sidebarWidth, height: layout.bodyHeight, overflow: 'hidden' },
					React.createElement(TextInputField, {
						width: layout.sidebarWidth,
						height: sidebarFilterHeight,
						label: 'Filter',
						focused: focusArea === 'filter',
						value: filterQuery,
						cursorPosition: filterCursor,
						placeholder: 'id, label, group, cluster',
						helperText: 'Type to narrow by id, label, group, or cluster.',
					}),
					React.createElement(SidebarList, {
						width: layout.sidebarWidth,
						height: sidebarHeight,
						title: filterQuery ? `Variables (${pages.length})` : 'Variables',
						focused: focusArea === 'sidebar',
						scrollState: {
							offset: safeSidebarOffset,
							viewportSize: sidebarViewportSize,
							totalSize: pages.length,
						},
						items: visibleSidebar.map((page, index) => ({
							id: page.key,
							label: page.entry.id,
							active: safeSidebarOffset + index === safePageIndex,
							tone: page.required ? 'required' : 'normal',
						})),
					}),
				),
				React.createElement(Text, null, ' '),
				React.createElement(
					Box,
					{ flexDirection: 'column', width: layout.contentWidth, height: layout.bodyHeight, overflow: 'hidden' },
					selectedPage
						? React.createElement(
							React.Fragment,
							null,
							React.createElement(ScrollPanel, {
								width: layout.contentWidth,
								height: layout.detailHeight,
								title: selectedPage.entry.label,
								lines: detailPanel.lines,
								focused: focusArea === 'content',
								tone: 'accent',
								scrollState: {
									offset: detailPanel.offset,
									viewportSize: detailPanel.viewportSize,
									totalSize: detailPanel.total,
								},
							}),
							React.createElement(TextInputField, {
								width: layout.contentWidth,
								height: layout.inputHeight,
								label: 'Value',
								focused: focusArea === 'content',
								value: draftValue,
								cursorPosition,
								secret: selectedPage.entry.sensitivity === 'secret',
								placeholder: '',
								helperText: '',
							}),
							React.createElement(
								Box,
								{ width: layout.contentWidth, height: layout.actionRowHeight },
								...actionRects.map((item, index) => React.createElement(
									item.label === 'Update + Next' ? PrimaryButton : SecondaryButton,
									{
										key: item.label,
										label: item.label,
										focused: focusArea === 'actions' && index === actionIndex,
										width: item.rect.width,
									},
								)),
							),
						)
						: React.createElement(EmptyState, {
							width: layout.contentWidth,
							height: layout.bodyHeight,
							title: 'No Matching Entries',
							message: 'No configuration variables match the current environment filter.',
						}),
				),
			);

			return React.createElement(AppFrame, { layout, topBar, body, footer });
		}

		instance = render(React.createElement(App), { exitOnCtrlC: false });
	});
}
