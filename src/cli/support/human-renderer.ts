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

function markdown(value: string) {
	return value.split('\n').map((line) => {
		if (/^#{1,6}\s/u.test(line)) return `\u001b[1;36m${line}\u001b[0m`;
		if (/^```/u.test(line)) return `\u001b[2;33m${line}\u001b[0m`;
		return line.replace(/\*\*([^*]+)\*\*/gu, '\u001b[1m$1\u001b[0m').replace(/`([^`]+)`/gu, '\u001b[33m$1\u001b[0m');
	}).join('\n');
}

function communicationPanels(result: Record<string, unknown>) {
	const responses = Array.isArray(result.responses) ? result.responses.filter((value) => value && typeof value === 'object') as Record<string, unknown>[] : [];
	const heading = `Channel ${scalar(result.channel)} · ${scalar(result.status)} · ${responses.length}/${Array.isArray(result.targets) ? result.targets.length : 0} responses`;
	const panels = responses.flatMap((response) => {
		const title = `${scalar(response.agentSlug)} · ${scalar(response.projectId)}`;
		return [`┌─ ${title}`, ...markdown(String(response.markdown ?? '')).split('\n').map((line) => `│ ${line}`), '└─'];
	});
	return [heading, ...panels, responses.length ? '' : 'No agent responses have completed yet.', `Send: ${scalar(result.sendId)}`].filter((line, index, all) => line !== '' || index < all.length - 1).join('\n');
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
	if (path === 'send' && result) return communicationPanels(result);
	const rendered = lines(envelope.result);
	const warnings = Array.isArray(envelope.warnings) && envelope.warnings.length ? [`Warnings: ${envelope.warnings.map(scalar).join('; ')}`] : [];
	const next = Array.isArray(envelope.nextActions) && envelope.nextActions.length ? ['Next actions:', ...envelope.nextActions.map((item) => `- ${scalar(item)}`)] : [];
	return [...rendered, ...warnings, ...next].join('\n') || 'Completed successfully.';
}
