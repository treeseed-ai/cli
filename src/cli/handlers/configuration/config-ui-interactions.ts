import { useInput, usePaste } from 'ink';
import type React from 'react';
import {
	findClickableRegion,
	routeWheelDeltaToScrollRegion,
	type UiClickRegion,
	type UiRect,
	type UiScrollRegion,
} from '../../ui/framework.js';
import { useTerminalMouse } from '../../ui/mouse.js';
import type {
	ConfigEditorOptions,
	ConfigEditorResult,
	ConfigFocusArea,
	ConfigPage,
	ConfigViewMode,
	ConfigViewportLayout,
} from './config-ui-types.js';
import { FULL_CONFIG_FILTERS } from './config-ui-model.js';
import { buttonRects, cycleFocus, deleteBackward, deleteForward } from './config-ui-layout.js';
import { applyConfigInputInsertion, isCtrlVPaste, readLinuxClipboardText } from './config-ui-input.js';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Ref<T> = { current: T };
type Panel = { offset: number; viewportSize: number; total: number };
type TabRect = { item: string; rect: UiRect };

type ConfigEditorInteractionInput = {
	actionIndex: number;
	actions: string[];
	activateAction: (label: string) => Promise<void>;
	cursorPosition: number;
	detailPanel: Panel;
	detailRect: UiRect;
	draftValue: string;
	envRects: TabRect[];
	exit: () => void;
	filterCursor: number;
	filterQuery: string;
	filterRect: UiRect;
	finish: (result: ConfigEditorResult | null) => void;
	finishWithOverrides: (overrides: Record<string, string>) => void;
	focusArea: ConfigFocusArea;
	layout: ConfigViewportLayout;
	options: ConfigEditorOptions;
	overrides: Record<string, string>;
	pages: ConfigPage[];
	safeSidebarOffset: number;
	saveCurrentDraft: (advance: boolean) => Promise<void>;
	selectedPage: ConfigPage | null;
	sidebarFilterHeight: number;
	sidebarHeight: number;
	sidebarRect: UiRect;
	sidebarViewportSize: number;
	visibleSidebar: ConfigPage[];
	viewMode: ConfigViewMode;
	focusAreaRef: Ref<ConfigFocusArea>;
	viewModeRef: Ref<ConfigViewMode>;
	selectedPageRef: Ref<ConfigPage | null>;
	draftValueRef: Ref<string>;
	cursorPositionRef: Ref<number>;
	filterQueryRef: Ref<string>;
	filterCursorRef: Ref<number>;
	setActionIndex: Setter<number>;
	setCursorPositions: Setter<Record<string, number>>;
	setDetailOffset: Setter<number>;
	setDrafts: Setter<Record<string, string>>;
	setFilterCursor: Setter<number>;
	setFilterIndex: Setter<number>;
	setFilterQuery: Setter<string>;
	setFocusArea: Setter<ConfigFocusArea>;
	setPageIndex: Setter<number>;
	setSidebarOffset: Setter<number>;
	setStatusMessage: Setter<string>;
};

export function useConfigEditorInteractions(state: ConfigEditorInteractionInput) {
	const {
		actionIndex, actions, activateAction, cursorPosition, detailPanel, detailRect, draftValue,
		envRects, exit, filterCursor, filterQuery, filterRect, finish, finishWithOverrides, focusArea,
		layout, options, overrides, pages, safeSidebarOffset, saveCurrentDraft, selectedPage,
		sidebarFilterHeight, sidebarHeight, sidebarRect, sidebarViewportSize, visibleSidebar,
		viewMode, focusAreaRef, viewModeRef, selectedPageRef, draftValueRef,
		cursorPositionRef, filterQueryRef, filterCursorRef, setActionIndex, setCursorPositions,
		setDetailOffset, setDrafts, setFilterCursor, setFilterIndex, setFilterQuery,
		setFocusArea, setPageIndex, setSidebarOffset, setStatusMessage,
	} = state;
	const clickRegions: UiClickRegion[] = [];

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


	return { actionRects, clickRegions };
}
