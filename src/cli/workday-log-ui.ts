import { Box, render, Text, useApp, useInput, useWindowSize } from 'ink';
import React from 'react';
import {
	AppFrame,
	clampOffset,
	computeViewportLayout,
	ensureVisible,
	findClickableRegion,
	routeWheelDeltaToScrollRegion,
	scrollOffsetByDelta,
	scrollOffsetByPage,
	SidebarList,
	StatusBar,
	truncateLine,
	type ScrollRegionState,
	type UiClickRegion,
	type UiRect,
	type UiScrollRegion,
	wrapText,
} from './ui/framework.js';
import type { DetailRow, WorkdayLogFocusArea, WorkdayLogSection, WorkdayLogUiInput } from './workday-log-types.js';
import { valueAt, artifactCount, modeOf, recordLabel, recordTone, computeWorkdayLogLayout, detailViewport } from './workday-log-model.js';
import { buildDetailRows } from './workday-log-details.js';

export type { WorkdayLogUiInput } from './workday-log-types.js';

function sidebarItemRect(layout: WorkdayLogLayout, section: WorkdayLogSection, index: number): UiRect {
	const top = section === 'planning' ? layout.topBarHeight + 2 : layout.topBarHeight + layout.planningHeight + 2;
	return {
		x: 1,
		y: top + index,
		width: layout.sidebarWidth - 2,
		height: 1,
	};
}

function WorkdayLogDetailPanel(props: {
	width: number;
	height: number;
	title: string;
	rows: DetailRow[];
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
			return React.createElement(Text, { key: `detail-${index}`, color: row.color ?? 'white', bold: row.bold }, truncateLine(row.text, props.width - 2));
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

function canRenderWorkdayLogUi() {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true' && process.env.ACT !== 'true');
}

export async function renderWorkdayLogInk(input: WorkdayLogUiInput) {
	if (!canRenderWorkdayLogUi()) {
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
			const layout = computeWorkdayLogLayout(windowSize?.rows ?? 24, windowSize?.columns ?? 120);
			const planningRecords = input.records.filter((record) => modeOf(record) !== 'acting');
			const actingRecords = input.records.filter((record) => modeOf(record) === 'acting');
			const [focusArea, setFocusArea] = React.useState<WorkdayLogFocusArea>('planning');
			const [planningIndex, setPlanningIndex] = React.useState(0);
			const [actingIndex, setActingIndex] = React.useState(0);
			const [planningOffset, setPlanningOffset] = React.useState(0);
			const [actingOffset, setActingOffset] = React.useState(0);
			const [detailOffset, setDetailOffset] = React.useState(0);
			const activeRecords = focusArea === 'acting' ? actingRecords : planningRecords;
			const activeIndex = focusArea === 'acting' ? actingIndex : planningIndex;
			const selectedRecord = activeRecords[activeIndex] ?? planningRecords[planningIndex] ?? actingRecords[actingIndex] ?? null;
			const detailRows = React.useMemo(() => buildDetailRows(selectedRecord, layout.detailWidth - 3), [selectedRecord, layout.detailWidth]);
			const detailView = detailViewport(detailRows, layout.bodyHeight, detailOffset);
			const planningViewportSize = Math.max(1, layout.planningHeight - 3);
			const actingViewportSize = Math.max(1, layout.actingHeight - 3);
			const safePlanningOffset = clampOffset(ensureVisible(planningIndex, planningOffset, planningViewportSize), planningRecords.length, planningViewportSize);
			const safeActingOffset = clampOffset(ensureVisible(actingIndex, actingOffset, actingViewportSize), actingRecords.length, actingViewportSize);
			const visiblePlanning = planningRecords.slice(safePlanningOffset, safePlanningOffset + planningViewportSize);
			const visibleActing = actingRecords.slice(safeActingOffset, safeActingOffset + actingViewportSize);

			React.useEffect(() => {
				if (safePlanningOffset !== planningOffset) setPlanningOffset(safePlanningOffset);
			}, [safePlanningOffset, planningOffset]);
			React.useEffect(() => {
				if (safeActingOffset !== actingOffset) setActingOffset(safeActingOffset);
			}, [safeActingOffset, actingOffset]);
			React.useEffect(() => {
				if (detailView.offset !== detailOffset) setDetailOffset(detailView.offset);
			}, [detailView.offset, detailOffset]);
			React.useEffect(() => {
				setDetailOffset(0);
			}, [selectedRecord]);

			const planningRect: UiRect = { x: 0, y: layout.topBarHeight, width: layout.sidebarWidth, height: layout.planningHeight };
			const actingRect: UiRect = { x: 0, y: layout.topBarHeight + layout.planningHeight, width: layout.sidebarWidth, height: layout.actingHeight };
			const detailRect: UiRect = { x: layout.sidebarWidth + 1, y: layout.topBarHeight, width: layout.detailWidth, height: layout.bodyHeight };
			const clickRegions: UiClickRegion[] = [
				...visiblePlanning.map((record, index) => ({
					id: `planning:${String(valueAt(record, 'id') ?? index)}`,
					rect: sidebarItemRect(layout, 'planning', index),
					onClick: () => {
						setFocusArea('planning');
						setPlanningIndex(safePlanningOffset + index);
					},
				})),
				...visibleActing.map((record, index) => ({
					id: `acting:${String(valueAt(record, 'id') ?? index)}`,
					rect: sidebarItemRect(layout, 'acting', index),
					onClick: () => {
						setFocusArea('acting');
						setActingIndex(safeActingOffset + index);
					},
				})),
			];
			const scrollRegions: UiScrollRegion[] = [
				{
					id: 'planning',
					rect: planningRect,
					state: { offset: safePlanningOffset, viewportSize: planningViewportSize, totalSize: planningRecords.length },
					onScroll: (offset) => {
						setPlanningOffset(offset);
						setPlanningIndex(offset);
					},
					onFocus: () => setFocusArea('planning'),
				},
				{
					id: 'acting',
					rect: actingRect,
					state: { offset: safeActingOffset, viewportSize: actingViewportSize, totalSize: actingRecords.length },
					onScroll: (offset) => {
						setActingOffset(offset);
						setActingIndex(offset);
					},
					onFocus: () => setFocusArea('acting'),
				},
				{
					id: 'detail',
					rect: detailRect,
					state: { offset: detailView.offset, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize },
					onScroll: (offset) => setDetailOffset(offset),
					onFocus: () => setFocusArea('detail'),
				},
			];

			useTerminalMouse((event) => {
				if (event.button === 'scroll-up' || event.button === 'scroll-down') {
					routeWheelDeltaToScrollRegion(scrollRegions, event.x, event.y, event.button === 'scroll-up' ? -1 : 1);
					return;
				}
				if (event.action === 'release' && event.button === 'left') {
					findClickableRegion(clickRegions, event.x, event.y)?.onClick();
				}
			}, { enabled: input.mouseEnabled === true });

			useInput((inputKey, key) => {
				if ((key.ctrl && inputKey === 'c') || key.escape || inputKey === 'q') {
					exit();
					finish(0);
					return;
				}
				if (key.tab) {
					setFocusArea((current) => current === 'planning' ? 'acting' : current === 'acting' ? 'detail' : 'planning');
					return;
				}
				if (focusArea === 'detail') {
					if (key.upArrow || inputKey === 'k') setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
					if (key.downArrow || inputKey === 'j') setDetailOffset((current) => scrollOffsetByDelta({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
					if (key.pageUp) setDetailOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, -1));
					if (key.pageDown) setDetailOffset((current) => scrollOffsetByPage({ offset: current, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize }, 1));
					return;
				}
				if (focusArea === 'planning') {
					if (key.upArrow || inputKey === 'k') setPlanningIndex((current) => Math.max(0, current - 1));
					if (key.downArrow || inputKey === 'j') setPlanningIndex((current) => Math.min(Math.max(0, planningRecords.length - 1), current + 1));
					if (key.pageUp) setPlanningIndex((current) => Math.max(0, current - planningViewportSize));
					if (key.pageDown) setPlanningIndex((current) => Math.min(Math.max(0, planningRecords.length - 1), current + planningViewportSize));
					if (key.return) setFocusArea('detail');
					return;
				}
				if (focusArea === 'acting') {
					if (key.upArrow || inputKey === 'k') setActingIndex((current) => Math.max(0, current - 1));
					if (key.downArrow || inputKey === 'j') setActingIndex((current) => Math.min(Math.max(0, actingRecords.length - 1), current + 1));
					if (key.pageUp) setActingIndex((current) => Math.max(0, current - actingViewportSize));
					if (key.pageDown) setActingIndex((current) => Math.min(Math.max(0, actingRecords.length - 1), current + actingViewportSize));
					if (key.return) setFocusArea('detail');
				}
			});

			const topBar = React.createElement(
				Box,
				{ flexDirection: 'column', width: layout.columns, overflow: 'hidden' },
				React.createElement(Text, { backgroundColor: 'cyan', color: 'black', bold: true }, truncateLine(` ${input.title} `, layout.columns)),
				React.createElement(Text, { color: 'white' }, truncateLine(input.subtitle, layout.columns)),
				React.createElement(Text, { color: 'gray' }, truncateLine(`Executions=${input.records.length} Planning=${planningRecords.length} Acting=${actingRecords.length}`, layout.columns)),
			);

			const body = React.createElement(
				Box,
				{ width: layout.columns, height: layout.bodyHeight, overflow: 'hidden' },
				React.createElement(
					Box,
					{ flexDirection: 'column', width: layout.sidebarWidth, height: layout.bodyHeight, overflow: 'hidden' },
					React.createElement(SidebarList, {
						width: layout.sidebarWidth,
						height: layout.planningHeight,
						title: `Planning Mode${focusArea === 'planning' ? ' • active' : ''}`,
						focused: focusArea === 'planning',
						scrollState: { offset: safePlanningOffset, viewportSize: planningViewportSize, totalSize: planningRecords.length },
						items: visiblePlanning.map((record, index) => ({
							id: String(valueAt(record, 'id') ?? index),
							label: `${recordLabel(record)} (${artifactCount(record)})`,
							active: focusArea !== 'acting' && selectedRecord === record,
							tone: recordTone(record),
						})),
					}),
					React.createElement(SidebarList, {
						width: layout.sidebarWidth,
						height: layout.actingHeight,
						title: `Acting Mode${focusArea === 'acting' ? ' • active' : ''}`,
						focused: focusArea === 'acting',
						scrollState: { offset: safeActingOffset, viewportSize: actingViewportSize, totalSize: actingRecords.length },
						items: visibleActing.map((record, index) => ({
							id: String(valueAt(record, 'id') ?? index),
							label: `${recordLabel(record)} (${artifactCount(record)})`,
							active: focusArea === 'acting' && selectedRecord === record,
							tone: recordTone(record),
						})),
					}),
				),
				React.createElement(Text, null, ' '),
				React.createElement(WorkdayLogDetailPanel, {
					width: layout.detailWidth,
					height: layout.bodyHeight,
					title: `Agent Execution Detail${focusArea === 'detail' ? ' • active' : ''}`,
					focused: focusArea === 'detail',
					rows: detailView.rows,
					scrollState: { offset: detailView.offset, viewportSize: detailView.viewportSize, totalSize: detailView.totalSize },
				}),
			);

			const footer = React.createElement(StatusBar, {
				width: layout.columns,
				accent: focusArea === 'detail',
				primary: 'Arrows/j/k move. Enter opens detail. Tab switches planning, acting, and detail. Wheel/PgUp/PgDn scroll. q exits.',
				secondary: `Focus: ${focusArea}. Mouse capture ${input.mouseEnabled === true ? 'enabled' : 'disabled'}.`,
			});

			return React.createElement(AppFrame, { layout, topBar, body, footer });
		}

		instance = render(React.createElement(App), { exitOnCtrlC: false });
	});
}

