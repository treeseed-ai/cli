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
import type {
	ConfigCommitUpdate,
	ConfigContextSnapshot,
	ConfigEditorOptions,
	ConfigEditorResult,
	ConfigFocusArea,
	ConfigPage,
	ConfigScope,
	ConfigViewMode,
} from './config-ui-types.js';
import { FULL_CONFIG_FILTERS, firstAvailableScope, resolveCurrentConfigValue, hasUsableValue, filterCliConfigPages } from './config-ui-model.js';
import { tabRects, buttonRects, computeConfigViewportLayout, buildCliConfigPages, buildStartupDetailLines, buildFullDetailLines, detailViewportLines, nextDraftValue, deleteBackward, deleteForward, cycleFocus } from './config-ui-layout.js';
import { applyConfigInputInsertion, readLinuxClipboardText, isCtrlVPaste } from './config-ui-input.js';
import { useConfigEditorInteractions } from './config-ui-interactions.js';
import { renderConfigEditorView } from './config-ui-view.js';

export type { ConfigEditorResult, ConfigInputState, ConfigPage, ConfigViewMode, ConfigViewportLayout, ConfigWizardStep } from './config-ui-types.js';
export { resolveCurrentConfigValue, filterCliConfigPages } from './config-ui-model.js';
export { buildCliConfigPages, computeConfigViewportLayout } from './config-ui-layout.js';
export { normalizeConfigInputChunk, applyConfigInputInsertion, readLinuxClipboardText } from './config-ui-input.js';

export async function runCliConfigEditor(
	context: ConfigContextSnapshot,
	options: ConfigEditorOptions = {},
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
				github: { configured: hasUsableValue(resolveCurrentConfigValue(currentContext, overrides, 'TREESEED_GITHUB_TOKEN', readinessScope)) },
				cloudflare: { configured: hasUsableValue(resolveCurrentConfigValue(currentContext, overrides, 'TREESEED_CLOUDFLARE_API_TOKEN', readinessScope)) },
				railway: { configured: hasUsableValue(resolveCurrentConfigValue(currentContext, overrides, 'TREESEED_RAILWAY_API_TOKEN', readinessScope)) },
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

			const { actionRects, clickRegions } = useConfigEditorInteractions({
				actionIndex, actions, activateAction, cursorPosition, detailPanel, detailRect, draftValue,
				envRects, exit, filterCursor, filterQuery, filterRect, finish, finishWithOverrides, focusArea,
				layout, options, overrides, pages, safeSidebarOffset, saveCurrentDraft, selectedPage,
				sidebarFilterHeight, sidebarHeight, sidebarRect, sidebarViewportSize, visibleSidebar,
				viewMode, focusAreaRef, viewModeRef, selectedPageRef, draftValueRef,
				cursorPositionRef, filterQueryRef, filterCursorRef, setActionIndex, setCursorPositions,
				setDetailOffset, setDrafts, setFilterCursor, setFilterIndex, setFilterQuery,
				setFocusArea, setPageIndex, setSidebarOffset, setStatusMessage,
			});
			return renderConfigEditorView({
				actionIndex, actionRects, configReadiness, currentContext, cursorPosition, detailPanel,
				draftValue, filterCursor, filterQuery, focusArea, layout, options, pages,
				safePageIndex, safeSidebarOffset, selectedFilter, selectedPage, sidebarFilterHeight,
				sidebarHeight, sidebarViewportSize, startupStep, statusMessage, viewMode, visibleSidebar,
			});
		}

		instance = render(React.createElement(App), { exitOnCtrlC: false });
	});
}
