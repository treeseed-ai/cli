import { Box, render, Text, useApp, useInput, useWindowSize } from 'ink';
import React from 'react';
import {
	AppFrame,
	clampOffset,
	computeViewportLayout,
	ensureVisible,
	findClickableRegion,
	popNavigationEntry,
	pushNavigationEntry,
	routeWheelDeltaToScrollRegion,
	scrollOffsetByDelta,
	scrollOffsetByPage,
	SecondaryButton,
	SidebarList,
	StatusBar,
	truncateLine,
	type ScrollRegionState,
	type UiClickRegion,
	type UiRect,
	type UiScrollRegion,
	wrapText,
} from '../ui/framework.js';
import { useTerminalMouse } from '../ui/mouse.js';
import { buildHelpView } from './help.js';
import type { CommandContext } from '../operations/operations-types.js';

import {
	buildSectionRows,
	buttonLabel,
	buttonRect,
	computeHelpViewportLayout,
	detailRowRect,
	detailViewport,
	nearestNavigableRow,
	nextNavigableRow,
	sidebarItemRect,
	type HelpFocusArea,
	type StyledRow,
} from './help-ui-model.js';

function HelpDetailPanel(props: {
	width: number;
	height: number;
	title: string;
	rows: StyledRow[];
	selectedRowIndex: number;
	focused?: boolean;
	scrollState: ScrollRegionState;
}) {
	const contentRows = Math.max(1, props.height - 3);
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, height: props.height, borderStyle: 'round', borderColor: props.focused ? 'cyan' : 'gray', overflow: 'hidden' },
		React.createElement(Text, { color: 'yellow', bold: true }, truncateLine(props.title, props.width - 2)),
		...Array.from({ length: contentRows }, (_, index) => {
			const row = props.rows[index] ?? { text: '' };
			const selected = index === props.selectedRowIndex && Boolean(row.targetCommand);
			return React.createElement(
				Text,
				{
					key: `detail-${index}`,
					color: selected ? 'black' : (row.color ?? 'white'),
					backgroundColor: selected ? 'cyan' : undefined,
					bold: row.bold,
				},
				truncateLine(row.text, props.width - 2),
			);
		}),
		React.createElement(
			Text,
			{ color: 'gray' },
			truncateLine(
				`${props.scrollState.offset > 0 ? '↑' : ' '} ${props.scrollState.offset + props.scrollState.viewportSize < props.scrollState.totalSize ? '↓' : ' '} lines ${props.scrollState.totalSize === 0 ? '0-0' : `${Math.min(props.scrollState.totalSize, props.scrollState.offset + 1)}-${Math.min(props.scrollState.totalSize, props.scrollState.offset + props.scrollState.viewportSize)}`} of ${props.scrollState.totalSize}`,
				props.width - 2,
			),
		),
	);
}

export async function renderHelpInk(commandName: string | null | undefined, context: Pick<CommandContext, 'outputFormat' | 'interactiveUi'> = {}) {
	if (!canRenderInkHelp({ outputFormat: context.outputFormat ?? 'human', interactiveUi: context.interactiveUi })) {
		return null;
	}

	return await new Promise<number>((resolveSession) => {
		let finished = false;
		let instance: ReturnType<typeof render> | undefined;

		const finish = (exitCode: number) => {
			if (finished) return;
			finished = true;
			instance?.unmount();
			resolveSession(exitCode);
		};

		function App() {
			const { exit } = useApp();
			const windowSize = useWindowSize();
			const layout: HelpLayout = computeHelpViewportLayout(windowSize?.rows ?? 24, windowSize?.columns ?? 100);
			const [focusArea, setFocusArea] = React.useState<HelpFocusArea>('sidebar');
			const [backHistory, setBackHistory] = React.useState<Array<string | null>>([]);
			const [forwardHistory, setForwardHistory] = React.useState<Array<string | null>>([]);
			const [currentCommand, setCurrentCommand] = React.useState<string | null>(commandName ?? null);
			const [sectionIndex, setSectionIndex] = React.useState(0);
			const [sidebarOffset, setSidebarOffset] = React.useState(0);
			const [detailOffset, setDetailOffset] = React.useState(0);
			const [contentRowIndex, setContentRowIndex] = React.useState(-1);

			const view = React.useMemo(() => buildHelpView(currentCommand), [currentCommand]);
			const safeSectionIndex = view.sections.length === 0 ? 0 : Math.min(sectionIndex, view.sections.length - 1);
			const sidebarViewportSize = Math.max(1, layout.bodyHeight - 4);
			const safeSidebarOffset = clampOffset(ensureVisible(safeSectionIndex, sidebarOffset, sidebarViewportSize), view.sections.length, sidebarViewportSize);
			const visibleSections = view.sections.slice(safeSidebarOffset, safeSidebarOffset + sidebarViewportSize);
			const selectedSection = view.sections[safeSectionIndex] ?? { id: 'empty', title: 'Help', lines: ['No help content is available.'] };
			const detailRows = buildSectionRows(selectedSection, layout.contentWidth - 2);
			const safeContentRowIndex = contentRowIndex >= 0 && contentRowIndex < detailRows.length
				? contentRowIndex
				: nearestNavigableRow(detailRows);
			const detailView = detailViewport(detailRows, layout.bodyHeight, detailOffset);
			const visibleSelectedRowIndex = safeContentRowIndex >= detailView.offset && safeContentRowIndex < detailView.offset + detailView.viewportSize
				? safeContentRowIndex - detailView.offset
				: -1;

			React.useEffect(() => {
				if (safeSidebarOffset !== sidebarOffset) {
					setSidebarOffset(safeSidebarOffset);
				}
			}, [safeSidebarOffset, sidebarOffset]);

			React.useEffect(() => {
				if (detailView.offset !== detailOffset) {
					setDetailOffset(detailView.offset);
				}
			}, [detailView.offset, detailOffset]);

			React.useEffect(() => {
				setSectionIndex(0);
				setSidebarOffset(0);
				setDetailOffset(0);
				setContentRowIndex(-1);
				setFocusArea('sidebar');
			}, [currentCommand]);

			React.useEffect(() => {
				setDetailOffset(0);
				setContentRowIndex(nearestNavigableRow(detailRows));
			}, [selectedSection.id]);

			const navigateToCommand = React.useCallback((targetCommand: string) => {
				if (!targetCommand) {
					return;
				}
				setBackHistory((current) => pushNavigationEntry(current, currentCommand));
				setForwardHistory([]);
				setCurrentCommand(targetCommand);
			}, [currentCommand]);

			const goBack = React.useCallback(() => {
				if (backHistory.length > 0) {
					const { nextStack, popped } = popNavigationEntry(backHistory);
					setBackHistory(nextStack);
					setForwardHistory((current) => pushNavigationEntry(current, currentCommand));
					setCurrentCommand(popped);
					return;
				}
				if (currentCommand !== null) {
					setForwardHistory((current) => pushNavigationEntry(current, currentCommand));
					setCurrentCommand(null);
					return;
				}
				exit();
				finish(view.exitCode);
			}, [backHistory, currentCommand, exit, view.exitCode]);

			const goForward = React.useCallback(() => {
				if (forwardHistory.length === 0) {
					return;
				}
				const { nextStack, popped } = popNavigationEntry(forwardHistory);
				setForwardHistory(nextStack);
				setBackHistory((current) => pushNavigationEntry(current, currentCommand));
				setCurrentCommand(popped);
			}, [currentCommand, forwardHistory]);

			const backLabel = currentCommand !== null ? 'Back to Help' : backHistory.length > 0 ? 'Back' : 'Exit Help';
			const backWidth = buttonLabel(backLabel).length;
			const backX = Math.max(0, layout.columns - backWidth);
			const topActionY = 3;
			const backButtonRect = buttonRect(backLabel, backX, topActionY);
			const sidebarRect: UiRect = { x: 0, y: layout.topBarHeight, width: layout.sidebarWidth, height: layout.bodyHeight };
			const detailRect: UiRect = { x: layout.sidebarWidth + 1, y: layout.topBarHeight, width: layout.contentWidth, height: layout.bodyHeight };

			const clickRegions: UiClickRegion[] = [
				{
					id: 'top-action-back',
					rect: backButtonRect,
					onClick: goBack,
				},
				...visibleSections.map((section, index) => ({
					id: `section:${section.id}`,
					rect: sidebarItemRect(layout, safeSidebarOffset, index, view.sections.length),
					onClick: () => {
						setSectionIndex(safeSidebarOffset + index);
						setFocusArea('sidebar');
					},
				})),
				...detailView.rows.flatMap((row, index) => row.targetCommand ? [{
					id: `detail:${row.targetCommand}:${index}`,
					rect: detailRowRect(layout, index),
					onClick: () => {
						setFocusArea('content');
						setContentRowIndex(detailView.offset + index);
						navigateToCommand(row.targetCommand!);
					},
				}] : []),
			];

			const scrollRegions: UiScrollRegion[] = [
				{
					id: 'help-sidebar',
					rect: sidebarRect,
					state: {
						offset: safeSidebarOffset,
						viewportSize: sidebarViewportSize,
						totalSize: view.sections.length,
					},
					onScroll: (offset) => {
						setSidebarOffset(offset);
						setSectionIndex(offset);
					},
					onFocus: () => setFocusArea('sidebar'),
				},
				{
					id: 'help-detail',
					rect: detailRect,
					state: {
						offset: detailView.offset,
						viewportSize: detailView.viewportSize,
						totalSize: detailView.totalSize,
					},
					onScroll: (offset) => setDetailOffset(offset),
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
					finish(view.exitCode);
					return;
				}
				if (key.escape || input === 'q') {
					exit();
					finish(view.exitCode);
					return;
				}
				if (input === 'b' || input === '[' || key.backspace) {
					goBack();
					return;
				}
				if (input === 'f' || input === ']') {
					goForward();
					return;
				}
				if (key.tab) {
					setFocusArea((current) => current === 'sidebar' ? 'content' : 'sidebar');
					return;
				}
				if (focusArea === 'sidebar') {
					if (key.upArrow || input === 'k') {
						setSectionIndex((current) => Math.max(0, current - 1));
						return;
					}
					if (key.downArrow || input === 'j') {
						setSectionIndex((current) => Math.min(Math.max(0, view.sections.length - 1), current + 1));
						return;
					}
					if (key.pageUp) {
						setSidebarOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: sidebarViewportSize, totalSize: view.sections.length }, -1));
						setSectionIndex((current) => Math.max(0, current - sidebarViewportSize));
						return;
					}
					if (key.pageDown) {
						setSidebarOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: sidebarViewportSize, totalSize: view.sections.length }, 1));
						setSectionIndex((current) => Math.min(Math.max(0, view.sections.length - 1), current + sidebarViewportSize));
						return;
					}
				}
				if (focusArea === 'content') {
					if (key.upArrow) {
						const next = nextNavigableRow(detailRows, safeContentRowIndex, -1);
						if (next >= 0) {
							setContentRowIndex(next);
							setDetailOffset((current) => ensureVisible(next, current, detailView.viewportSize));
						} else {
							setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
						}
						return;
					}
					if (key.downArrow) {
						const next = nextNavigableRow(detailRows, safeContentRowIndex, 1);
						if (next >= 0) {
							setContentRowIndex(next);
							setDetailOffset((current) => ensureVisible(next, current, detailView.viewportSize));
						} else {
							setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
						}
						return;
					}
					if (input === 'k') {
						setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
						return;
					}
					if (input === 'j') {
						setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
						return;
					}
					if (key.pageUp) {
						setDetailOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
						return;
					}
					if (key.pageDown) {
						setDetailOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
						return;
					}
					if (key.return && safeContentRowIndex >= 0) {
						const targetCommand = detailRows[safeContentRowIndex]?.targetCommand;
						if (targetCommand) {
							navigateToCommand(targetCommand);
						}
						return;
					}
				}
			});

			const topBar = React.createElement(
				Box,
				{ flexDirection: 'column', width: layout.columns, overflow: 'hidden' },
				React.createElement(Text, { backgroundColor: 'cyan', color: 'black', bold: true }, truncateLine(` ${view.title} `, layout.columns)),
				React.createElement(Text, { color: 'white' }, truncateLine(view.subtitle ?? '', layout.columns)),
				React.createElement(Text, { color: 'gray' }, truncateLine(view.badge ?? '', layout.columns)),
				React.createElement(
					Box,
					{ width: layout.columns, justifyContent: 'space-between' },
					React.createElement(Text, { color: 'gray' }, truncateLine(currentCommand === null ? 'Main Help' : `Viewing ${currentCommand}`, Math.max(1, layout.columns - backButtonRect.width - 2))),
					React.createElement(SecondaryButton, {
						label: backLabel,
						focused: false,
						width: backButtonRect.width,
					}),
				),
			);

			const body = React.createElement(
				Box,
				{ width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
				React.createElement(SidebarList, {
					width: layout.sidebarWidth,
					height: layout.bodyHeight,
					title: `${view.sidebarTitle}${focusArea === 'sidebar' ? ' • active' : ''}`,
					focused: focusArea === 'sidebar',
					scrollState: {
						offset: safeSidebarOffset,
						viewportSize: sidebarViewportSize,
						totalSize: view.sections.length,
					},
					items: visibleSections.map((section, index) => ({
						id: section.id,
						label: section.title,
						active: safeSidebarOffset + index === safeSectionIndex,
						tone: 'normal',
					})),
				}),
				React.createElement(Text, null, ' '),
				React.createElement(HelpDetailPanel, {
					width: layout.contentWidth,
					height: layout.bodyHeight,
					title: `${selectedSection.title}${focusArea === 'content' ? ' • active' : ''}`,
					focused: focusArea === 'content',
					rows: detailView.rows,
					selectedRowIndex: visibleSelectedRowIndex,
					scrollState: {
						offset: detailView.offset,
						viewportSize: detailView.viewportSize,
						totalSize: detailView.totalSize,
					},
				}),
			);

			const footer = React.createElement(StatusBar, {
				width: layout.columns,
				accent: focusArea === 'content',
				primary: 'Wheel or PgUp/PgDn scroll the hovered or focused panel. Enter opens the selected command. b/[ goes back. f/] goes forward. q exits.',
				secondary: `${view.statusSecondary}  Focus: ${focusArea}.`,
			});

			return React.createElement(AppFrame, { layout, topBar, body, footer });
		}

		instance = render(React.createElement(App), { exitOnCtrlC: false });
	});
}

export function shouldUseInkHelp(context: Pick<CommandContext, 'outputFormat' | 'interactiveUi'>) {
	return Boolean(context.interactiveUi !== false && canRenderInkHelp({ outputFormat: context.outputFormat ?? 'human' }));
}

function canRenderInkHelp(context: Pick<CommandContext, 'outputFormat' | 'interactiveUi'>) {
	return Boolean(
		context.interactiveUi !== false
		&& context.outputFormat !== 'json'
		&& !isNonHumanInteractiveEnvironment()
		&& process.stdin.isTTY
		&& process.stdout.isTTY,
	);
}

function isNonHumanInteractiveEnvironment() {
	return process.env.CI === 'true'
		|| process.env.GITHUB_ACTIONS === 'true'
		|| process.env.ACT === 'true'
		|| typeof process.env.TREESEED_VERIFY_DRIVER === 'string';
}

