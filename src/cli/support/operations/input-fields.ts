function parts(field: string) {
	const keys = field.split('.');
	if (keys.length > 8 || keys.some(key => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Unsafe operation input field.');
	return keys;
}

export function setOperationInputField(target: Record<string, unknown>, field: string, value: unknown) {
	const keys = parts(field); let current = target;
	for (const key of keys.slice(0, -1)) {
		if (!Object.hasOwn(current, key)) current[key] = {};
		const child = current[key];
		if (!child || typeof child !== 'object' || Array.isArray(child)) throw new Error('Conflicting operation input field.');
		current = child as Record<string, unknown>;
	}
	const leaf = keys.at(-1)!;
	if (Object.hasOwn(current, leaf)) throw new Error('Duplicate operation input field.');
	current[leaf] = value;
}

export function getOperationInputField(target: Record<string, unknown>, field: string): unknown {
	let value: unknown = target;
	for (const key of parts(field)) {
		if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}
