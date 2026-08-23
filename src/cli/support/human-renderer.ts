function label(value: string) {
	return value.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/[_-]+/gu, ' ').replace(/^./u, (character) => character.toUpperCase());
}

function scalar(value: unknown) {
	if (typeof value === 'boolean') return value ? 'yes' : 'no';
	if (value === null || value === undefined || value === '') return 'none';
	return String(value);
}

function lines(value: unknown, depth = 0): string[] {
	if (value === null || value === undefined || typeof value !== 'object') return [scalar(value)];
	if (Array.isArray(value)) {
		if (value.length === 0) return ['none'];
		if (value.every((item) => item === null || typeof item !== 'object')) return [value.map(scalar).join(', ')];
		return value.flatMap((item) => {
			const rendered = lines(item, depth + 1);
			return rendered.map((entry, index) => `${index === 0 ? '- ' : '  '}${entry}`);
		});
	}
	if (depth >= 3) return [`${Object.keys(value as Record<string, unknown>).length} fields`];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
		if (item === undefined || item === null) return [];
		if (typeof item !== 'object') return [`${label(key)}: ${scalar(item)}`];
		if (Array.isArray(item) && item.every((entry) => entry === null || typeof entry !== 'object')) return [`${label(key)}: ${lines(item, depth + 1)[0]}`];
		return [`${label(key)}:`, ...lines(item, depth + 1).map((entry) => `  ${entry}`)];
	});
}

function principalName(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const principal = value as Record<string, unknown>;
	return String(principal.displayName ?? principal.username ?? principal.email ?? principal.id ?? '').trim() || null;
}

export function renderHumanCommandResult(value: unknown) {
	if (!value || typeof value !== 'object') return scalar(value);
	const envelope = value as { commandPath?: string[]; ok?: boolean; result?: unknown; warnings?: unknown[]; nextActions?: unknown[] };
	const path = envelope.commandPath?.join(' ') ?? '';
	const result = envelope.result as Record<string, unknown> | null;
	if (path === 'auth login' && result) {
		const name = principalName(result.principal);
		return [name ? `Logged in to ${scalar(result.serverId)} as ${name}.` : `Logged in to ${scalar(result.serverId)}.`,
			result.expiresAt ? `Session expires: ${scalar(result.expiresAt)}` : '',
			Array.isArray(result.scopes) ? `Scopes: ${result.scopes.map(scalar).join(', ')}` : ''].filter(Boolean).join('\n');
	}
	if (path === 'auth logout' && result) return `Logged out of ${scalar(result.serverId)}.`;
	if (path === 'auth status' && result) {
		const name = principalName(result.principal);
		const teams = Array.isArray(result.teams) ? result.teams.length : 0;
		return `${name ? `Authenticated as ${name}.` : 'Not authenticated.'}\nTeams available: ${teams}`;
	}
	const rendered = lines(envelope.result);
	const warnings = Array.isArray(envelope.warnings) && envelope.warnings.length ? [`Warnings: ${envelope.warnings.map(scalar).join('; ')}`] : [];
	const next = Array.isArray(envelope.nextActions) && envelope.nextActions.length ? ['Next actions:', ...envelope.nextActions.map((item) => `- ${scalar(item)}`)] : [];
	return [...rendered, ...warnings, ...next].join('\n') || 'Completed successfully.';
}
