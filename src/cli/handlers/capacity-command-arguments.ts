import type { TreeseedParsedInvocation } from '../types.js';

export function capacityStringArg(invocation: TreeseedParsedInvocation, name: string) {
	const value = invocation.args[name];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function capacityFlagArg(invocation: TreeseedParsedInvocation, name: string) {
	return invocation.args[name] === true;
}

export function capacityBooleanArg(invocation: TreeseedParsedInvocation, name: string, fallback = false) {
	const value = invocation.args[name];
	if (value === true) return true;
	if (value === false) return false;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
		if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	}
	return fallback;
}

export function capacityNumberArg(invocation: TreeseedParsedInvocation, name: string) {
	const value = invocation.args[name];
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) return Number(value);
	return null;
}

export function capacityCsvArg(invocation: TreeseedParsedInvocation, name: string, fallback: string[]) {
	const value = capacityStringArg(invocation, name);
	if (!value || value === 'all') return fallback;
	const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return entries.length ? [...new Set(entries)] : fallback;
}

export function capacityPositiveNumberArg(invocation: TreeseedParsedInvocation, name: string, fallback: number) {
	const value = capacityNumberArg(invocation, name);
	return value && value > 0 ? Math.floor(value) : fallback;
}

export function capacityProviderSelector(invocation: TreeseedParsedInvocation) {
	return capacityStringArg(invocation, 'provider') ?? 'local';
}

export function capacityEnvironmentSelector(invocation: TreeseedParsedInvocation) {
	return capacityStringArg(invocation, 'environment') ?? 'local';
}
