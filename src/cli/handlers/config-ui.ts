import { Box, render, Text, useApp, useInput, useWindowSize } from 'ink';
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
	type UiRect,
	type UiScrollRegion,
	type UiViewportLayout,
	routeWheelDeltaToScrollRegion,
	ScrollPanel,
	SecondaryButton,
	StatusBar,
	TextInputField,
	TopTabs,
	truncateLine,
	wrapText,
} from '../ui/framework.js';
import { useTerminalMouse } from '../ui/mouse.js';

type ConfigScope = 'all' | 'local' | 'staging' | 'prod';
export type ConfigViewMode = 'startup' | 'full';
type ConfigFocusArea = 'environment' | 'mode' | 'sidebar' | 'content' | 'actions';

type ConfigEntry = {
	id: string;
	label: string;
	group: string;
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
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
	authStatusByScope: Record<Exclude<ConfigScope, 'all'>, { gh: { authenticated: boolean }; wrangler: { authenticated: boolean }; railway: { authenticated: boolean } }>;
};

export type ConfigPage = {
	key: string;
	entry: ConfigEntry;
	scope: Exclude<ConfigScope, 'all'>;
	scopes: Array<Exclude<ConfigScope, 'all'>>;
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

export type ConfigViewportLayout = UiViewportLayout & {
	sidebarWidth: number;
	contentWidth: number;
	detailHeight: number;
	detailViewportHeight: number;
	inputHeight: number;
	actionRowHeight: number;
};

const CONFIG_FILTERS: ConfigScope[] = ['all', 'local', 'staging', 'prod'];
const CONFIG_VIEW_MODES: ConfigViewMode[] = ['startup', 'full'];

function maskValue(value: string) {
	if (!value) {
		return '(unset)';
	}
	if (value.length <= 8) {
		return '********';
	}
	return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function scopeOrder(scope: Exclude<ConfigScope, 'all'>) {
	return ['local', 'staging', 'prod'].indexOf(scope);
}

function resolveFirstNonEmptyValue(
	scopes: Array<Exclude<ConfigScope, 'all'>>,
	entriesByScope: ConfigContextSnapshot['entriesByScope'],
	entryId: string,
	field: 'currentValue' | 'suggestedValue',
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

function hasUsableValue(value: string) {
	return typeof value === 'string' && value.trim().length > 0;
}

function isWizardRequiredMissing(page: Omit<ConfigPage, 'wizardRequiredMissing'>) {
	if (!page.required) {
		return false;
	}
	const resolvedValue = page.currentValue || page.suggestedValue || page.finalValue || page.entry.effectiveValue || '';
	return !hasUsableValue(resolvedValue);
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
	const layout = computeViewportLayout(rows, columns, { topBarHeight: 2, footerHeight: 2 });
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
	const selectedScopes = selectedFilter === 'all' ? context.scopes : context.scopes.filter((scope) => scope === selectedFilter);
	const sharedEntries = new Set<string>();
	const pages: ConfigPage[] = [];

	for (const scope of selectedScopes) {
		for (const entry of context.entriesByScope[scope]) {
			if (entry.storage === 'shared') {
				if (sharedEntries.has(entry.id)) {
					continue;
				}
				const relevantScopes = selectedScopes.filter((candidateScope) => context.entriesByScope[candidateScope].some((candidate) => candidate.id === entry.id));
				const key = `shared:${entry.id}`;
				sharedEntries.add(entry.id);
				const currentValue = resolveFirstNonEmptyValue(relevantScopes, context.entriesByScope, entry.id, 'currentValue');
				const suggestedValue = resolveFirstNonEmptyValue(relevantScopes, context.entriesByScope, entry.id, 'suggestedValue');
				const candidatePage = {
					key,
					entry,
					scope,
					scopes: relevantScopes,
					required: relevantScopes.some((candidateScope) => context.entriesByScope[candidateScope].some((candidate) => candidate.id === entry.id && candidate.required)),
					currentValue,
					suggestedValue,
					finalValue: key in overrides ? overrides[key] : (currentValue || suggestedValue || entry.effectiveValue || ''),
				};
				pages.push({
					...candidatePage,
					wizardRequiredMissing: isWizardRequiredMissing(candidatePage),
				});
				continue;
			}

			const key = `${scope}:${entry.id}`;
			const candidatePage = {
				key,
				entry,
				scope,
				scopes: [scope],
				required: entry.required,
				currentValue: entry.currentValue,
				suggestedValue: entry.suggestedValue,
				finalValue: key in overrides ? overrides[key] : (entry.currentValue || entry.suggestedValue || entry.effectiveValue || ''),
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
		if (left.entry.storage !== right.entry.storage) {
			return left.entry.storage === 'shared' ? -1 : 1;
		}
		if (left.entry.purposes.length !== right.entry.purposes.length) {
			return right.entry.purposes.length - left.entry.purposes.length;
		}
		if (left.entry.group !== right.entry.group) {
			return left.entry.group.localeCompare(right.entry.group);
		}
		if (left.scope !== right.scope) {
			return scopeOrder(left.scope) - scopeOrder(right.scope);
		}
		return left.entry.label.localeCompare(right.entry.label);
	});

	return viewMode === 'startup' ? orderedPages.filter((page) => page.wizardRequiredMissing) : orderedPages;
}

function buildStartupDetailLines(step: ConfigWizardStep | null, draftValue: string) {
	if (!step) {
		return ['No startup configuration is required for the selected environment set.'];
	}
	return [
		`Step ${step.index + 1} of ${step.total}`,
		step.entry.label,
		step.entry.id,
		`${step.required ? 'Required' : 'Optional'} ${step.entry.storage === 'shared' ? 'shared' : 'environment-specific'} value for ${step.scopes.join(', ')}`,
		'',
		step.entry.description || 'Treeseed needs this value to complete setup.',
		'',
		`How to get it: ${step.entry.howToGet || 'Use the suggested/default value if it matches your setup.'}`,
		`Current value: ${formatDisplayValue(step, step.currentValue, '(unset)')}`,
		`Suggested value: ${formatDisplayValue(step, step.suggestedValue, '(none)')}`,
		`Pending value: ${formatDisplayValue(step, draftValue, '(unset)')}`,
	];
}

function buildFullDetailLines(page: ConfigPage | null, draftValue: string) {
	if (!page) {
		return ['No configuration entries match the selected environment filter.'];
	}
	return [
		page.entry.label,
		page.entry.id,
		`Scope: ${page.scopes.join(', ')}`,
		`Storage: ${page.entry.storage} | ${page.required ? 'required' : 'optional'}`,
		`Group: ${page.entry.group}`,
		`Used for: ${page.entry.purposes.join(', ') || '(none)'}`,
		`Targets: ${page.entry.targets.join(', ') || '(none)'}`,
		'',
		'About',
		page.entry.description || '(no description)',
		'',
		'How to get it',
		page.entry.howToGet || '(no extra setup guidance)',
		'',
		`Current: ${formatDisplayValue(page, page.currentValue, '(unset)')}`,
		`Suggested: ${formatDisplayValue(page, page.suggestedValue, '(none)')}`,
		`Pending: ${formatDisplayValue(page, draftValue, '(unset)')}`,
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
		? ['environment', 'mode', 'content', 'actions']
		: ['environment', 'mode', 'sidebar', 'content', 'actions'];
	const index = areas.indexOf(current);
	return areas[(index + 1) % areas.length] ?? 'content';
}

export async function runCliConfigEditor(
	context: ConfigContextSnapshot,
	options: { initialViewMode?: ConfigViewMode } = {},
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
			const [filterIndex, setFilterIndex] = React.useState(0);
			const [viewMode, setViewMode] = React.useState<ConfigViewMode>(options.initialViewMode ?? 'startup');
			const [pageIndex, setPageIndex] = React.useState(0);
			const [sidebarOffset, setSidebarOffset] = React.useState(0);
			const [detailOffset, setDetailOffset] = React.useState(0);
			const [drafts, setDrafts] = React.useState<Record<string, string>>({});
			const [cursorPositions, setCursorPositions] = React.useState<Record<string, number>>({});
			const [overrides, setOverrides] = React.useState<Record<string, string>>({});
			const [focusArea, setFocusArea] = React.useState<ConfigFocusArea>(options.initialViewMode === 'full' ? 'sidebar' : 'content');
			const [actionIndex, setActionIndex] = React.useState(0);
			const [statusMessage, setStatusMessage] = React.useState('Startup wizard ready. Click or Tab through controls, then update values one step at a time.');
			const { exit } = useApp();
			const windowSize = useWindowSize();
			const layout = computeConfigViewportLayout(windowSize?.rows ?? 24, windowSize?.columns ?? 100);
			const selectedFilter = CONFIG_FILTERS[filterIndex] ?? 'all';
			const pages = buildCliConfigPages(context, selectedFilter, overrides, viewMode);
			const safePageIndex = pages.length === 0 ? 0 : Math.min(pageIndex, pages.length - 1);
			const selectedPage = pages[safePageIndex] ?? null;
			const draftValue = nextDraftValue(selectedPage, drafts);
			const cursorPosition = selectedPage ? Math.max(0, Math.min(cursorPositions[selectedPage.key] ?? draftValue.length, draftValue.length)) : 0;
			const startupStep = selectedPage ? { ...selectedPage, index: safePageIndex, total: pages.length } : null;
			const detailSourceLines = viewMode === 'startup'
				? buildStartupDetailLines(startupStep, draftValue)
				: buildFullDetailLines(selectedPage, draftValue);
			const detailPanel = detailViewportLines(detailSourceLines, layout.contentWidth, layout.detailHeight, detailOffset);
			const authStatus = context.authStatusByScope.local ?? context.authStatusByScope[context.scopes[0]];
			const sidebarViewportSize = Math.max(1, layout.bodyHeight - 4);
			const safeSidebarOffset = clampOffset(ensureVisible(safePageIndex, sidebarOffset, sidebarViewportSize), pages.length, sidebarViewportSize);
			const visibleSidebar = pages.slice(safeSidebarOffset, safeSidebarOffset + sidebarViewportSize);
			const startupActions = selectedPage
				? ['Back', ...(hasUsableValue(selectedPage?.suggestedValue ?? '') ? ['Use Suggested + Next'] : []), 'Update + Next', 'Full Editor']
				: ['Open Full Editor', 'Save and Continue'];
			const fullActions = ['Update + Next', 'Clear', 'Startup Wizard', 'Finish'];
			const actions = viewMode === 'startup' ? startupActions : fullActions;
			const envRects = tabRects('Env ', CONFIG_FILTERS, filterIndex, 2, 1);
			const modeRects = tabRects('View ', CONFIG_VIEW_MODES, CONFIG_VIEW_MODES.indexOf(viewMode), 2, Math.floor(layout.columns / 2));
			const clickRegions: UiClickRegion[] = [];
			const sidebarRect = { x: 0, y: layout.topBarHeight, width: layout.sidebarWidth, height: layout.bodyHeight };
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
			}, [viewMode]);

			React.useEffect(() => {
				setDetailOffset(0);
			}, [selectedPage?.key]);

			React.useEffect(() => {
				if (selectedPage && !(selectedPage.key in cursorPositions)) {
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: draftValue.length }));
				}
			}, [cursorPositions, draftValue.length, selectedPage]);

			React.useEffect(() => {
				setFocusArea(viewMode === 'full' ? 'sidebar' : 'content');
			}, [viewMode]);

			const saveCurrentDraft = React.useCallback((advance: boolean) => {
				if (!selectedPage) {
					return;
				}
				const value = nextDraftValue(selectedPage, drafts);
				setOverrides((current) => ({ ...current, [selectedPage.key]: value }));
				setStatusMessage(`Updated ${selectedPage.entry.id}.`);
				if (advance) {
					setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + 1));
					setDetailOffset(0);
				}
			}, [drafts, pages.length, selectedPage]);

			const activateAction = React.useCallback((label: string) => {
				if (label === 'Back') {
					setPageIndex((current) => Math.max(0, current - 1));
					setDetailOffset(0);
					return;
				}
				if (label === 'Use Suggested + Next' && selectedPage) {
					const suggested = selectedPage.suggestedValue || selectedPage.finalValue;
					setDrafts((current) => ({ ...current, [selectedPage.key]: suggested }));
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: suggested.length }));
					setOverrides((current) => ({ ...current, [selectedPage.key]: suggested }));
					setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + 1));
					setStatusMessage(`Accepted suggested value for ${selectedPage.entry.id}.`);
					setDetailOffset(0);
					return;
				}
				if (label === 'Update + Next') {
					saveCurrentDraft(true);
					return;
				}
				if (label === 'Clear' && selectedPage) {
					setDrafts((current) => ({ ...current, [selectedPage.key]: '' }));
					setCursorPositions((current) => ({ ...current, [selectedPage.key]: 0 }));
					setOverrides((current) => ({ ...current, [selectedPage.key]: '' }));
					setStatusMessage(`Cleared ${selectedPage.entry.id}.`);
					return;
				}
				if (label === 'Full Editor') {
					setViewMode('full');
					setFocusArea('sidebar');
					setStatusMessage('Switched to the advanced editor.');
					return;
				}
				if (label === 'Startup Wizard') {
					setViewMode('startup');
					setFocusArea('content');
					setStatusMessage('Switched back to the startup wizard.');
					return;
				}
				if (label === 'Open Full Editor') {
					setViewMode('full');
					setFocusArea('sidebar');
					setStatusMessage('Opened the advanced editor.');
					return;
				}
				if (label === 'Save and Continue' || label === 'Finish') {
					finish({
						overrides,
						viewMode,
					});
				}
			}, [overrides, pages.length, saveCurrentDraft, selectedPage, viewMode]);

			const scrollRegions: UiScrollRegion[] = [
				...(viewMode === 'full'
					? [{
						id: 'config-sidebar',
						rect: sidebarRect,
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
			});

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

				if (input === 't') {
					setViewMode((current) => current === 'startup' ? 'full' : 'startup');
					return;
				}

				if (input === 's') {
					if (viewMode === 'startup' && selectedPage) {
						setStatusMessage('Complete each required startup step before saving. Use Update + Next to continue.');
						return;
					}
					finish({
						overrides,
						viewMode,
					});
					return;
				}

				if (focusArea === 'environment') {
					if (key.leftArrow) {
						setFilterIndex((current) => Math.max(0, current - 1));
						setPageIndex(0);
						return;
					}
					if (key.rightArrow) {
						setFilterIndex((current) => Math.min(CONFIG_FILTERS.length - 1, current + 1));
						setPageIndex(0);
						return;
					}
				}

				if (focusArea === 'mode') {
					if (key.leftArrow || key.rightArrow || key.return) {
						setViewMode((current) => current === 'startup' ? 'full' : 'startup');
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
						saveCurrentDraft(true);
						return;
					}
					if (!key.ctrl && !key.meta && input && selectedPage && !key.upArrow && !key.downArrow && !key.pageDown && !key.pageUp) {
						const nextValue = insertAt(draftValue, input, cursorPosition);
						setDrafts((current) => ({ ...current, [selectedPage.key]: nextValue }));
						setCursorPositions((current) => ({ ...current, [selectedPage.key]: cursorPosition + input.length }));
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
						activateAction(actions[actionIndex] ?? actions[0] ?? 'Save and Continue');
					}
				}
			});

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

			for (const [index, item] of modeRects.entries()) {
				clickRegions.push({
					id: `mode-${item.item}`,
					rect: item.rect,
					onClick: () => {
						setViewMode(CONFIG_VIEW_MODES[index] ?? 'startup');
						setFocusArea('mode');
					},
				});
			}

			clickRegions.push({
				id: 'detail-focus',
				rect: detailRect,
				onClick: () => {
					setFocusArea('content');
				},
			});

			if (viewMode === 'full') {
				for (let index = 0; index < visibleSidebar.length; index += 1) {
					const page = visibleSidebar[index];
					if (!page) {
						continue;
					}
					clickRegions.push({
						id: `sidebar-${page.key}`,
						rect: { x: 1, y: layout.topBarHeight + 2 + index, width: layout.sidebarWidth - 2, height: 1 },
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
						activateAction(item.label);
					},
				});
			}

			const topBar = React.createElement(
				React.Fragment,
				null,
				React.createElement(Text, { color: 'cyan', bold: true }, truncateLine(`Treeseed Config  ${context.project.name} (${context.project.slug})  GH:${authStatus?.gh?.authenticated ? 'ok' : 'missing'}  CF:${authStatus?.wrangler?.authenticated ? 'ok' : 'missing'}  RW:${authStatus?.railway?.authenticated ? 'ok' : 'missing'}`, layout.columns)),
				React.createElement(
					Box,
					{ width: layout.columns },
					React.createElement(TopTabs, {
						width: Math.floor(layout.columns / 2) - 1,
						title: 'Env',
						items: CONFIG_FILTERS.map((filter) => ({ id: filter, label: filter })),
						activeId: selectedFilter,
						focused: focusArea === 'environment',
					}),
					React.createElement(TopTabs, {
						width: Math.ceil(layout.columns / 2),
						title: 'View',
						items: CONFIG_VIEW_MODES.map((mode) => ({ id: mode, label: mode === 'startup' ? 'wizard' : 'full' })),
						activeId: viewMode,
						focused: focusArea === 'mode',
					}),
				),
			);

			const footer = React.createElement(StatusBar, {
				width: layout.columns,
				accent: focusArea === 'content',
				primary: viewMode === 'full'
					? 'Tab cycles controls. Type in the input when focused. Sidebar arrows or wheel change variables. Detail PgUp/PgDn or wheel scroll help text.'
					: 'Wizard input is live when focused. Type to edit, Left/Right move the cursor, Enter updates and advances, PgUp/PgDn or wheel scroll help text.',
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
							title: startupStep ? `Startup Wizard  ${startupStep.index + 1}/${startupStep.total}` : 'Startup Wizard',
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
							label: selectedPage.entry.sensitivity === 'secret' ? 'New value' : 'New value',
							focused: focusArea === 'content',
							value: draftValue,
							cursorPosition,
							secret: selectedPage.entry.sensitivity === 'secret',
							placeholder: selectedPage.suggestedValue || '(empty)',
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
						title: 'Startup Complete',
						message: 'No startup configuration items remain for the selected environment. You can finish now or switch to the full editor for advanced settings.',
					});

				return React.createElement(AppFrame, { layout, topBar, body, footer });
			}

			const body = React.createElement(
				Box,
				{ width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
				React.createElement(SidebarList, {
					width: layout.sidebarWidth,
					height: layout.bodyHeight,
					title: 'Variables',
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
								label: 'New value',
								focused: focusArea === 'content',
								value: draftValue,
								cursorPosition,
								secret: selectedPage.entry.sensitivity === 'secret',
								placeholder: selectedPage.suggestedValue || '(empty)',
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
