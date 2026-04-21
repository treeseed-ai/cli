import { Box, Text } from 'ink';
import React from 'react';

export type HumanUiSessionResult<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
	submitted: boolean;
	payload: TPayload;
};

export type UiViewportLayout = {
	rows: number;
	columns: number;
	topBarHeight: number;
	bodyHeight: number;
	footerHeight: number;
	totalHeight: number;
};

export type InteractiveControlState = {
	focused?: boolean;
	active?: boolean;
	disabled?: boolean;
};

export type ScrollRegionState = {
	offset: number;
	viewportSize: number;
	totalSize: number;
};

export type UiScrollRegion = {
	id: string;
	rect: UiRect;
	state: ScrollRegionState;
	onScroll: (offset: number) => void;
	onFocus?: () => void;
};

export type UiClickRegion = {
	id: string;
	rect: UiRect;
	onClick: () => void;
};

export type UiNavigationStack<T> = T[];

export type UiRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type TabItem = {
	id: string;
	label: string;
};

export function computeViewportLayout(rows: number, columns: number, options: { topBarHeight?: number; footerHeight?: number } = {}): UiViewportLayout {
	const safeRows = Math.max(12, rows || 24);
	const safeColumns = Math.max(72, columns || 100);
	const topBarHeight = options.topBarHeight ?? 2;
	const footerHeight = options.footerHeight ?? 2;
	const bodyHeight = Math.max(6, safeRows - topBarHeight - footerHeight);
	return {
		rows: safeRows,
		columns: safeColumns,
		topBarHeight,
		bodyHeight,
		footerHeight,
		totalHeight: topBarHeight + bodyHeight + footerHeight,
	};
}

export function clampOffset(offset: number, totalItems: number, viewportSize: number) {
	return Math.max(0, Math.min(offset, Math.max(0, totalItems - viewportSize)));
}

export function scrollOffsetByDelta(state: ScrollRegionState, delta: number) {
	return clampOffset(state.offset + delta, state.totalSize, state.viewportSize);
}

export function scrollOffsetByPage(state: ScrollRegionState, pages: number) {
	return scrollOffsetByDelta(state, Math.max(1, state.viewportSize) * pages);
}

export function ensureVisible(index: number, offset: number, viewportSize: number) {
	if (viewportSize <= 0) {
		return 0;
	}
	if (index < offset) {
		return index;
	}
	if (index >= offset + viewportSize) {
		return Math.max(0, index - viewportSize + 1);
	}
	return offset;
}

export function truncateLine(value: string, width: number) {
	if (width <= 0) {
		return '';
	}
	if (value.length <= width) {
		return value.padEnd(width, ' ');
	}
	if (width <= 1) {
		return value.slice(0, width);
	}
	return `${value.slice(0, Math.max(0, width - 1))}…`;
}

export function formatSecretMaskedValue(value: string) {
	if (!value) {
		return '(unset)';
	}

	const normalized = value
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
		.replace(/\n+/g, ' ')
		.trim();
	if (!normalized) {
		return '(unset)';
	}

	if (normalized.length === 1) {
		return `${normalized} [1]`;
	}

	const maxRevealedTotal = Math.max(2, Math.floor(normalized.length * 0.25));
	const revealPerSide = Math.min(3, Math.max(1, Math.floor(maxRevealedTotal / 2)));
	const leading = normalized.slice(0, revealPerSide);
	const trailing = normalized.slice(Math.max(revealPerSide, normalized.length - revealPerSide));
	const maskedCount = Math.max(0, normalized.length - leading.length - trailing.length);
	const maskedMiddle = '*'.repeat(maskedCount);
	return `${leading}${maskedMiddle}${trailing} [${normalized.length}]`;
}

export function wrapText(value: string, width: number) {
	if (width <= 0) {
		return [''];
	}
	const normalized = value.replace(/\r/g, '');
	const output: string[] = [];
	for (const sourceLine of normalized.split('\n')) {
		if (!sourceLine) {
			output.push('');
			continue;
		}
		let remaining = sourceLine;
		while (remaining.length > width) {
			let breakIndex = remaining.lastIndexOf(' ', width);
			if (breakIndex <= 0) {
				breakIndex = width;
			}
			output.push(remaining.slice(0, breakIndex).trimEnd());
			remaining = remaining.slice(breakIndex).trimStart();
		}
		output.push(remaining);
	}
	return output.length > 0 ? output : [''];
}

export function containsPoint(rect: UiRect, x: number, y: number) {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function findClickableRegion(regions: UiClickRegion[], x: number, y: number) {
	return regions.find((region) => containsPoint(region.rect, x, y)) ?? null;
}

export function findScrollRegion(regions: UiScrollRegion[], x: number, y: number) {
	return regions.find((region) => containsPoint(region.rect, x, y)) ?? null;
}

export function routeWheelDeltaToScrollRegion(regions: UiScrollRegion[], x: number, y: number, delta: number) {
	const region = findScrollRegion(regions, x, y);
	if (!region) {
		return false;
	}
	region.onFocus?.();
	region.onScroll(scrollOffsetByDelta(region.state, delta));
	return true;
}

export function pushNavigationEntry<T>(stack: UiNavigationStack<T>, entry: T) {
	return [...stack, entry];
}

export function popNavigationEntry<T>(stack: UiNavigationStack<T>) {
	if (stack.length === 0) {
		return { nextStack: stack, popped: null as T | null };
	}
	return {
		nextStack: stack.slice(0, -1),
		popped: stack.at(-1) ?? null,
	};
}

type AppFrameProps = {
	layout: UiViewportLayout;
	topBar: React.ReactNode;
	body: React.ReactNode;
	footer: React.ReactNode;
};

export function AppFrame(props: AppFrameProps) {
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.layout.columns, height: props.layout.totalHeight, overflow: 'hidden' },
		React.createElement(Box, { flexDirection: 'column', height: props.layout.topBarHeight, overflow: 'hidden' }, props.topBar),
		React.createElement(Box, { height: props.layout.bodyHeight, overflow: 'hidden' }, props.body),
		React.createElement(Box, { flexDirection: 'column', height: props.layout.footerHeight, overflow: 'hidden' }, props.footer),
	);
}

type TopTabsProps = {
	title?: string;
	items: TabItem[];
	activeId: string;
	focused?: boolean;
	width: number;
	prefix?: string;
};

export function TopTabs(props: TopTabsProps) {
	const line = `${props.prefix ?? ''}${props.items.map((item) => item.id === props.activeId ? `[${item.label}]` : item.label).join(' ')}`;
	return React.createElement(Text, {
		color: props.focused ? 'black' : 'cyan',
		backgroundColor: props.focused ? 'cyan' : undefined,
	}, truncateLine(props.title ? `${props.title} ${line}` : line, props.width));
}

type SidebarListProps = {
	width: number;
	height: number;
	items: Array<{ id: string; label: string; active?: boolean; tone?: 'required' | 'normal' }>;
	focused?: boolean;
	scrollState?: ScrollRegionState;
	title?: string;
};

export function SidebarList(props: SidebarListProps) {
	const topIndicator = props.scrollState && props.scrollState.offset > 0 ? '↑ more' : '';
	const bottomIndicator = props.scrollState && props.scrollState.offset + props.scrollState.viewportSize < props.scrollState.totalSize
		? '↓ more'
		: '';
	const bodyHeight = Math.max(1, props.height - 2 - (props.title ? 1 : 0) - (topIndicator ? 1 : 0) - (props.scrollState ? 1 : 0));
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, height: props.height, borderStyle: 'round', borderColor: props.focused ? 'cyan' : 'gray', overflow: 'hidden' },
		...(props.title
			? [React.createElement(Text, { key: 'title', color: 'yellow', bold: true }, truncateLine(props.title, props.width - 2))]
			: []),
		...(topIndicator
			? [React.createElement(Text, { key: 'top-indicator', color: 'gray' }, truncateLine(topIndicator, props.width - 2))]
			: []),
		...Array.from({ length: bodyHeight }, (_, index) => {
			const item = props.items[index];
			return React.createElement(
				Text,
				{
					key: `sidebar-${item?.id ?? index}`,
					color: item?.active ? 'black' : item?.tone === 'required' ? 'yellow' : 'white',
					backgroundColor: item?.active ? 'green' : undefined,
				},
				truncateLine(item?.label ?? '', props.width - 2),
			);
		}),
		...(props.scrollState
			? [React.createElement(
				Text,
				{ key: 'scroll-status', color: 'gray' },
				truncateLine(
					`${bottomIndicator || ''} ${props.scrollState.totalSize === 0 ? '0 items' : `${Math.min(props.scrollState.totalSize, props.scrollState.offset + 1)}-${Math.min(props.scrollState.totalSize, props.scrollState.offset + props.scrollState.viewportSize)} of ${props.scrollState.totalSize}`}`.trim(),
					props.width - 2,
				),
			)]
			: []),
	);
}

type ScrollPanelProps = {
	width: number;
	height: number;
	title?: string;
	lines: string[];
	focused?: boolean;
	tone?: 'normal' | 'accent';
	scrollState?: ScrollRegionState;
};

export function ScrollPanel(props: ScrollPanelProps) {
	const headerRows = props.title ? 1 : 0;
	const footerRows = props.scrollState ? 1 : 0;
	const contentRows = Math.max(1, props.height - 2 - headerRows - footerRows);
	const topIndicator = props.scrollState && props.scrollState.offset > 0 ? '↑' : ' ';
	const bottomIndicator = props.scrollState && props.scrollState.offset + props.scrollState.viewportSize < props.scrollState.totalSize ? '↓' : ' ';
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, height: props.height, borderStyle: 'round', borderColor: props.focused ? 'cyan' : props.tone === 'accent' ? 'green' : 'gray', overflow: 'hidden' },
		...(props.title
			? [React.createElement(Text, { key: 'title', color: 'yellow', bold: true }, truncateLine(props.title, props.width - 2))]
			: []),
		...Array.from({ length: contentRows }, (_, index) => React.createElement(
			Text,
			{ key: `line-${index}` },
			truncateLine(props.lines[index] ?? '', props.width - 2),
		)),
		...(props.scrollState
			? [React.createElement(
				Text,
				{ key: 'scroll-status', color: 'gray' },
				truncateLine(
					`${topIndicator}${bottomIndicator} lines ${props.scrollState.totalSize === 0 ? '0-0' : `${Math.min(props.scrollState.totalSize, props.scrollState.offset + 1)}-${Math.min(props.scrollState.totalSize, props.scrollState.offset + props.scrollState.viewportSize)}`} of ${props.scrollState.totalSize}`,
					props.width - 2,
				),
			)]
			: []),
	);
}

type FieldCardProps = {
	width: number;
	height: number;
	title: string;
	lines: string[];
	focused?: boolean;
};

export function FieldCard(props: FieldCardProps) {
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, height: props.height, borderStyle: 'round', borderColor: props.focused ? 'cyan' : 'blue', overflow: 'hidden' },
		React.createElement(Text, { color: 'blue', bold: true }, truncateLine(props.title, props.width - 2)),
		...Array.from({ length: props.height - 3 }, (_, index) => React.createElement(
			Text,
			{ key: `field-${index}`, color: index === 0 ? 'white' : 'gray' },
			truncateLine(props.lines[index] ?? '', props.width - 2),
		)),
	);
}

type TextInputFieldProps = {
	label: string;
	value: string;
	width: number;
	height?: number;
	focused?: boolean;
	secret?: boolean;
	placeholder?: string;
	cursorPosition?: number;
	helperText?: string;
};

function renderTextInputContent(props: TextInputFieldProps) {
	const safeCursor = Math.max(0, Math.min(props.cursorPosition ?? props.value.length, props.value.length));
	const placeholder = props.placeholder ?? '';
	const contentWidth = Math.max(1, props.width - 2);
	if (!props.focused && !props.value) {
		return React.createElement(Text, { color: 'gray' }, truncateLine(placeholder || ' '.repeat(contentWidth), contentWidth));
	}

	const visibleValue = props.secret && props.value.length > 0 ? formatSecretMaskedValue(props.value) : props.value;
	if (!props.focused) {
		return React.createElement(Text, null, truncateLine(visibleValue || placeholder, contentWidth));
	}

	const preservedPrefix = visibleValue.slice(0, safeCursor);
	const visiblePrefix = preservedPrefix.slice(Math.max(0, preservedPrefix.length - Math.max(0, contentWidth - 1)));
	const cursorCell = visibleValue[safeCursor] ?? ' ';
	const padding = ' '.repeat(Math.max(0, contentWidth - visiblePrefix.length - 1));
	return React.createElement(
		Text,
		null,
		visiblePrefix,
		React.createElement(Text, { color: 'black', backgroundColor: 'cyan' }, cursorCell),
		padding,
	);
}

export function TextInputField(props: TextInputFieldProps) {
	const height = props.height ?? 4;
	const placeholder = props.placeholder ?? '';
	const helperText = props.helperText ?? (props.value.length > 0
		? (props.secret ? 'Secret value captured. Paste or type a replacement, or leave this as-is.' : 'Type a replacement value or leave this as-is.')
		: placeholder);
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, height, borderStyle: 'round', borderColor: props.focused ? 'cyan' : 'blue', overflow: 'hidden' },
		React.createElement(Text, { color: 'blue', bold: true }, truncateLine(props.label, props.width - 2)),
		renderTextInputContent(props),
		React.createElement(Text, { color: 'gray' }, truncateLine(helperText || ' ', props.width - 2)),
	);
}

type TextAreaFieldProps = {
	label: string;
	value: string;
	width: number;
	height: number;
	focused?: boolean;
};

export function TextAreaField(props: TextAreaFieldProps) {
	return React.createElement(FieldCard, {
		width: props.width,
		height: props.height,
		title: props.label,
		focused: props.focused,
		lines: wrapText(props.value || 'Value is unset.', Math.max(1, props.width - 2)),
	});
}

type ButtonProps = {
	label: string;
	focused?: boolean;
	active?: boolean;
	width?: number;
};

function ActionButton(props: ButtonProps & { tone: 'primary' | 'secondary' }) {
	const color = props.tone === 'primary' ? 'black' : 'white';
	const backgroundColor = props.tone === 'primary' ? 'green' : 'gray';
	return React.createElement(
		Text,
		{
			color: props.focused ? 'black' : color,
			backgroundColor: props.focused ? 'cyan' : backgroundColor,
		},
		truncateLine(`[ ${props.label} ]`, props.width ?? (`[ ${props.label} ]`.length)),
	);
}

export function PrimaryButton(props: ButtonProps) {
	return React.createElement(ActionButton, { ...props, tone: 'primary' });
}

export function SecondaryButton(props: ButtonProps) {
	return React.createElement(ActionButton, { ...props, tone: 'secondary' });
}

type StatusBarProps = {
	width: number;
	primary: string;
	secondary?: string;
	accent?: boolean;
};

export function StatusBar(props: StatusBarProps) {
	return React.createElement(
		Box,
		{ flexDirection: 'column', width: props.width, overflow: 'hidden' },
		React.createElement(Text, { color: props.accent ? 'cyan' : 'gray' }, truncateLine(props.primary, props.width)),
		React.createElement(Text, { color: 'gray' }, truncateLine(props.secondary ?? '', props.width)),
	);
}

export function EmptyState(props: { width: number; height: number; title: string; message: string }) {
	return React.createElement(
		FieldCard,
		{
			width: props.width,
			height: props.height,
			title: props.title,
			lines: wrapText(props.message, Math.max(1, props.width - 2)),
		},
	);
}

export function ConfirmDialog(props: { width: number; title: string; message: string }) {
	return React.createElement(
		FieldCard,
		{
			width: props.width,
			height: 6,
			title: props.title,
			lines: wrapText(props.message, Math.max(1, props.width - 2)),
		},
	);
}
