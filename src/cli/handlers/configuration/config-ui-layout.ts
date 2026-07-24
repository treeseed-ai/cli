import {
	clampOffset,
	computeViewportLayout,
	truncateLine,
	wrapText,
} from '../../ui/framework.js';
import type {
	ConfigContextSnapshot,
	ConfigEntry,
	ConfigFocusArea,
	ConfigPage,
	ConfigScope,
	ConfigViewMode,
	ConfigViewportLayout,
	ConfigWizardStep,
} from './config-ui-types.js';
import { scopeOrder, providerWorkflowRank, normalizedClusterKey, resolveSharedEntryValue, isWizardRequiredMissing, startupPriority, formatDisplayValue } from './config-ui-model.js';

export function tabRects(prefix: string, items: string[], selectedIndex: number, y: number, startX: number) {
	let x = startX + prefix.length;
	return items.map((item, index) => {
		const label = index === selectedIndex ? `[${item}]` : item;
		const rect = { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: label.length, height: 1 };
		x += label.length + 1;
		return { item, rect };
	});
}

export function buttonLabel(label: string) {
	return `[ ${label} ]`;
}

export function buttonRects(labels: string[], y: number, startX: number) {
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

export function buildStartupDetailLines(step: ConfigWizardStep | null, draftValue: string) {
	if (!step) {
		return ['No startup configuration is required for the selected environment set.'];
	}
	return [
		`${step.entry.label} (${step.entry.id})`,
		`Applies to: ${step.scopes.join(', ')}`,
		`Required in: ${step.requiredScopes.join(', ')}`,
		`Storage: ${step.entry.storage}`,
		...(step.entry.sourceRequirement ? [
			`Host source: ${step.entry.sourceRequirement}${step.entry.sourceProvider ? ` (${step.entry.sourceProvider})` : ''}${step.entry.sourceHostType ? ` / ${step.entry.sourceHostType}` : ''}`,
		] : []),
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

export function buildFullDetailLines(page: ConfigPage | null, draftValue: string) {
	if (!page) {
		return ['No configuration entries match the selected environment filter.'];
	}
	return [
		`${page.entry.label} (${page.entry.id})`,
		`Scope: ${page.scopes.join(', ')}`,
		`Storage: ${page.entry.storage} | ${page.required ? 'required' : 'optional'}`,
		`Group: ${page.entry.group}`,
		...(page.entry.sourceRequirement ? [
			`Host source: ${page.entry.sourceRequirement}${page.entry.sourceProvider ? ` (${page.entry.sourceProvider})` : ''}${page.entry.sourceHostType ? ` / ${page.entry.sourceHostType}` : ''}`,
		] : []),
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

export function detailViewportLines(lines: string[], width: number, height: number, offset: number) {
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

export function nextDraftValue(page: ConfigPage | null, drafts: Record<string, string>) {
	if (!page) {
		return '';
	}
	return page.key in drafts ? drafts[page.key] : page.finalValue;
}

export function resolveEntryPageFinalValue(pageKey: string, entry: ConfigEntry, overrides: Record<string, string>) {
	if (pageKey in overrides) {
		return overrides[pageKey]!;
	}
	return entry.effectiveValue || entry.suggestedValue || entry.currentValue || '';
}

export function insertAt(value: string, insert: string, cursor: number) {
	return `${value.slice(0, cursor)}${insert}${value.slice(cursor)}`;
}

export function deleteBackward(value: string, cursor: number) {
	if (cursor <= 0) {
		return { value, cursor };
	}
	return {
		value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`,
		cursor: cursor - 1,
	};
}

export function deleteForward(value: string, cursor: number) {
	if (cursor >= value.length) {
		return { value, cursor };
	}
	return {
		value: `${value.slice(0, cursor)}${value.slice(cursor + 1)}`,
		cursor,
	};
}

export function cycleFocus(current: ConfigFocusArea, viewMode: ConfigViewMode) {
	const areas: ConfigFocusArea[] = viewMode === 'startup'
		? ['content', 'actions']
		: ['environment', 'filter', 'sidebar', 'content', 'actions'];
	const index = areas.indexOf(current);
	return areas[(index + 1) % areas.length] ?? 'content';
}
