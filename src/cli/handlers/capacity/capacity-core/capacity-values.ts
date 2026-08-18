export function formatCapacityNumber(value: unknown, digits = 2) {
	if (value === null || value === undefined || value === '') return 'n/a';
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return String(value);
	return numeric.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function capacityRecordValue(record: unknown, key: string) {
	return record && typeof record === 'object' && key in record ? (record as Record<string, unknown>)[key] : undefined;
}

export function capacityMarketRequest<T>(client: unknown, path: string, options: { method?: string; body?: unknown; requireAuth?: boolean; headers?: Record<string, string> } = {}) {
	return (client as { request<TResponse>(path: string, options?: { method?: string; body?: unknown; requireAuth?: boolean; headers?: Record<string, string> }): Promise<TResponse> }).request<T>(path, options);
}

export function capacityAuthenticatedMarketRequest<T>(client: unknown, path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
	return capacityMarketRequest<T>(client, path, { ...options, requireAuth: true });
}

export function isCapacityRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function capacityRecord(value: unknown): Record<string, unknown> {
	return isCapacityRecord(value) ? value : {};
}

export function firstCapacityString(...values: unknown[]) {
	for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
}

export function capacityCollectionItems(payload: unknown) {
	if (Array.isArray(payload)) return payload;
	return isCapacityRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
}

export function capacityQuery(filters: Record<string, string | number | null>) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
	return query.toString() ? `?${query.toString()}` : '';
}
