const SENSITIVE_VALUE_KEY = /(?:authorization|bearer|password|secret(?:value)?|api.?key|access.?token|lease.?token|credential(?:value)?|registration.?key|private.?key)$/iu;
const SAFE_METADATA_KEY = /(?:ref|id|prefix|fingerprint|status|expiresAt|createdAt|updatedAt)$/iu;

export function redactCapacityOutputSecrets(value: unknown, key = ''): unknown {
	if (SENSITIVE_VALUE_KEY.test(key) && !SAFE_METADATA_KEY.test(key) && (!value || typeof value !== 'object')) return '<redacted>';
	if (Array.isArray(value)) return value.map((entry) => redactCapacityOutputSecrets(entry));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
		return [key, redactCapacityOutputSecrets(entry, key)];
	}));
}
