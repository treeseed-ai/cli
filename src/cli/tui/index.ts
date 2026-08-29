import stringWidth from 'string-width';

export const WORKBENCH_MIN_WIDTH = 72;
export const WORKBENCH_MIN_HEIGHT = 22;
export const WORKBENCH_WIDE_WIDTH = 112;

const stripEscape = (value: string) => value.replace(/\u001b/gu, '');

export function highlightedMarkdown(value: string, lineNumbers = false) {
	let fenced = false;
	const lines = stripEscape(value).split('\n');
	const digits = String(Math.max(1, lines.length)).length;
	return lines.map((source, index) => {
		let line = source;
		const prefix = lineNumbers ? `\u001b[38;5;8m${String(index + 1).padStart(digits)} │\u001b[0m ` : '';
		if (/^```/u.test(line)) {
			fenced = !fenced;
			line = `\u001b[38;5;141m${line}\u001b[0m`;
		} else if (fenced) line = `\u001b[38;5;114m${line}\u001b[0m`;
		else if (/^#{1,6}\s/u.test(line)) line = `\u001b[1;38;5;81m${line}\u001b[0m`;
		else line = line.replace(/(`[^`]+`)/gu, '\u001b[38;5;114m$1\u001b[0m').replace(/(\*\*[^*]+\*\*)/gu, '\u001b[1m$1\u001b[0m').replace(/(\[[^\]]+\]\([^)]+\))/gu, '\u001b[4;38;5;75m$1\u001b[0m');
		return prefix + line;
	}).join('\n');
}

export function cellWidth(value: string) { return stringWidth(value); }

export function truncateCells(value: string, width: number) {
	let result = '';
	for (const character of value) {
		if (cellWidth(result + character) > width) break;
		result += character;
	}
	return result;
}

export function stableSelection<T extends { id: string }>(items: T[], selected: string | null) {
	return selected && items.some((item) => item.id === selected) ? selected : items[0]?.id ?? null;
}

export function topicSlug(value: string) {
	const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 72);
	if (!slug) throw new Error('Topic must contain a letter or number.');
	return slug;
}

export function workbenchLayout(width: number, height: number, split: number) {
	const narrow = width < WORKBENCH_WIDE_WIDTH;
	const left = narrow ? 24 : Math.max(26, Math.floor(width * .22));
	const right = narrow ? 0 : Math.max(28, Math.floor(width * .25));
	const main = width - left - right - 2;
	const body = height - 2;
	const top = Math.max(10, Math.floor(body * split));
	const bottom = body - top - 1;
	return { narrow, left, right, main, body, top, bottom };
}

export function fixedSidebarLayout(bodyHeight: number, operationsHeight: number) {
	const bottom = Math.max(6, Math.min(operationsHeight, bodyHeight - 7));
	const top = Math.max(6, bodyHeight - bottom - 1);
	return { top, bottom };
}
