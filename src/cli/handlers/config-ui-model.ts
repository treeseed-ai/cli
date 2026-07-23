import { formatSecretMaskedValue } from '../ui/framework.js';
import type { ConfigContextSnapshot, ConfigEntry, ConfigPage, ConfigScope, ConfigViewMode } from './config-ui-types.js';

export const FULL_CONFIG_FILTERS: ConfigScope[] = ['local', 'staging', 'prod'];

export function firstAvailableScope(context: ConfigContextSnapshot, preferred: ConfigScope = 'local') {
	if (context.scopes.includes(preferred)) {
		return preferred;
	}
	return context.scopes[0] ?? preferred;
}

export function maskValue(value: string) {
	if (!value) {
		return '(unset)';
	}
	return formatSecretMaskedValue(value);
}

export function scopeOrder(scope: ConfigScope) {
	return ['local', 'staging', 'prod'].indexOf(scope);
}

export function providerWorkflowKey(entry: ConfigEntry) {
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

export function providerWorkflowRank(entry: ConfigEntry) {
	const order = ['auth-core', 'github', 'cloudflare', 'railway', 'local-development', 'forms', 'smtp'];
	const index = order.indexOf(providerWorkflowKey(entry));
	return index === -1 ? order.length : index;
}

export function normalizedClusterKey(entry: ConfigEntry) {
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

export function resolveFirstNonEmptyValue(
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

export function resolveSharedEntryValue(
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

export function hasUsableValue(value: string) {
	return typeof value === 'string' && value.trim().length > 0;
}

export function isConfigValueValid(entry: ConfigEntry, value: string) {
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

export function isWizardRequiredMissing(page: Omit<ConfigPage, 'wizardRequiredMissing'>) {
	if (page.requiredScopes.length === 0) {
		return false;
	}
	return !isConfigValueValid(page.entry, page.finalValue);
}

export function startupPriority(page: ConfigPage) {
	if (page.required) {
		return 0;
	}
	if (page.wizardRequiredMissing) {
		return 1;
	}
	return 2;
}

export function formatDisplayValue(page: ConfigPage, value: string, emptyLabel: string) {
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

