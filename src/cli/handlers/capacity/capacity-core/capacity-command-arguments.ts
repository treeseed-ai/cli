import type { ParsedInvocation } from '../../../types.js';

export function capacityStringArg(invocation: ParsedInvocation, name: string) {
	const value = invocation.args[name];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function capacityFlagArg(invocation: ParsedInvocation, name: string) {
	return invocation.args[name] === true;
}

export function capacityBooleanArg(invocation: ParsedInvocation, name: string, fallback = false) {
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

export function capacityNumberArg(invocation: ParsedInvocation, name: string) {
	const value = invocation.args[name];
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) return Number(value);
	return null;
}

export function capacityCsvArg(invocation: ParsedInvocation, name: string, fallback: string[]) {
	const value = capacityStringArg(invocation, name);
	if (!value || value === 'all') return fallback;
	const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return entries.length ? [...new Set(entries)] : fallback;
}

export function capacityPositiveNumberArg(invocation: ParsedInvocation, name: string, fallback: number) {
	const value = capacityNumberArg(invocation, name);
	return value && value > 0 ? Math.floor(value) : fallback;
}

export function capacityProviderSelector(invocation: ParsedInvocation) {
	return capacityStringArg(invocation, 'provider') ?? 'local';
}

export function capacityEnvironmentSelector(invocation: ParsedInvocation) {
	return capacityStringArg(invocation, 'environment') ?? 'local';
}
