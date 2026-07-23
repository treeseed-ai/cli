import {
	clampOffset,
	computeViewportLayout,
	type UiRect,
	wrapText,
} from './ui/framework.js';
import type { TreeseedHelpEntry, TreeseedHelpSection } from './help.js';

export type HelpLayout = ReturnType<typeof computeHelpViewportLayout>;
export type HelpFocusArea = 'sidebar' | 'content';

export type StyledRow = {
	text: string;
	color?: 'cyan' | 'gray' | 'white' | 'yellow' | 'green' | 'magenta' | 'red' | 'blue' | 'black';
	bold?: boolean;
	targetCommand?: string;
};

export function sidebarTopIndicatorNeeded(totalSize: number, viewportSize: number, offset: number) {
	return totalSize > 0 && offset > 0;
}

export function sidebarItemRect(layout: HelpLayout, offset: number, index: number, totalSections: number): UiRect {
	const itemTop = layout.topBarHeight + 1 + 1 + (sidebarTopIndicatorNeeded(totalSections, Math.max(1, layout.bodyHeight - 4), offset) ? 1 : 0);
	return {
		x: 1,
		y: itemTop + index,
		width: layout.sidebarWidth - 2,
		height: 1,
	};
}

export function detailRowRect(layout: HelpLayout, rowIndex: number): UiRect {
	return {
		x: layout.sidebarWidth + 2,
		y: layout.topBarHeight + 1 + rowIndex,
		width: layout.contentWidth - 2,
		height: 1,
	};
}

export function toneForEntry(entry: TreeseedHelpEntry) {
	switch (entry.accent) {
		case 'flag':
			return { color: 'magenta' as const, bold: true };
		case 'argument':
			return { color: entry.required ? 'yellow' as const : 'cyan' as const, bold: true };
		case 'example':
			return { color: 'green' as const, bold: true };
		case 'alias':
		case 'related':
			return { color: 'blue' as const, bold: true };
		case 'command':
		default:
			return { color: 'cyan' as const, bold: true };
	}
}

export function styledWrap(text: string, width: number, style: Pick<StyledRow, 'color' | 'bold'> = {}, targetCommand?: string) {
	const wrapped = wrapText(text, width);
	return wrapped.map((line, index) => ({
		text: line,
		...style,
		targetCommand: index === 0 ? targetCommand : undefined,
	}));
}

export function buildSectionRows(section: TreeseedHelpSection, width: number) {
	const rows: StyledRow[] = [];
	for (const entry of section.entries ?? []) {
		rows.push(...styledWrap(entry.label, width, toneForEntry(entry), entry.targetCommand));
		if (entry.summary) {
			rows.push(...styledWrap(`  ${entry.summary}`, width, { color: 'gray' }));
		}
		rows.push({ text: '', color: 'gray' });
	}
	for (const line of section.lines ?? []) {
		rows.push(...styledWrap(line, width, { color: 'white' }));
	}
	while (rows.length > 0 && !rows.at(-1)?.text) {
		rows.pop();
	}
	return rows.length > 0 ? rows : [{ text: '(empty)', color: 'gray' }];
}

export function computeHelpViewportLayout(rows: number, columns: number) {
	const layout = computeViewportLayout(rows, columns, { topBarHeight: 4, footerHeight: 2 });
	const sidebarWidth = Math.max(22, Math.min(30, Math.floor(layout.columns * 0.27)));
	const contentWidth = Math.max(38, layout.columns - sidebarWidth - 1);
	return {
		...layout,
		sidebarWidth,
		contentWidth,
	};
}

export function detailViewport(rows: StyledRow[], height: number, offset: number) {
	const viewportSize = Math.max(1, height - 3);
	const safeOffset = clampOffset(offset, rows.length, viewportSize);
	return {
		rows: rows.slice(safeOffset, safeOffset + viewportSize),
		offset: safeOffset,
		viewportSize,
		totalSize: rows.length,
	};
}

export function buttonLabel(label: string) {
	return `[ ${label} ]`;
}

export function buttonRect(label: string, x: number, y: number): UiRect {
	return { x, y, width: buttonLabel(label).length, height: 1 };
}

export function navigableRowIndices(rows: StyledRow[]) {
	return rows.flatMap((row, index) => row.targetCommand ? [index] : []);
}

export function nearestNavigableRow(rows: StyledRow[], fromIndex = 0) {
	const indices = navigableRowIndices(rows);
	if (indices.length === 0) {
		return -1;
	}
	const match = indices.find((index) => index >= fromIndex);
	return match ?? indices[0] ?? -1;
}

export function nextNavigableRow(rows: StyledRow[], currentIndex: number, direction: -1 | 1) {
	const indices = navigableRowIndices(rows);
	if (indices.length === 0) {
		return -1;
	}
	if (currentIndex < 0) {
		return direction > 0 ? (indices[0] ?? -1) : (indices.at(-1) ?? -1);
	}
	if (direction > 0) {
		const next = indices.find((index) => index > currentIndex);
		return next ?? currentIndex;
	}
	const reversed = [...indices].reverse();
	const next = reversed.find((index) => index < currentIndex);
	return next ?? currentIndex;
}

