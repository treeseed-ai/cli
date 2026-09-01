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

type RenderOptions = { color?: boolean; width?: number };
const ansi = (enabled: boolean, code: string, value: string) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
const sanitize = (value: string) => value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');

function inlineMarkdown(value: string, color: boolean) {
	return value
		.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_, label, url) => `${ansi(color, '4;36', label)} ${ansi(color, '2', `<${url}>`)}`)
		.replace(/\*\*([^*]+)\*\*/gu, (_, content) => ansi(color, '1', content))
		.replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, (_, content) => ansi(color, '3', content))
		.replace(/`([^`]+)`/gu, (_, content) => ansi(color, '33', content));
}

function highlightCode(value: string, color: boolean) {
	return value.replace(/\b(const|let|var|function|return|if|else|await|async|import|export|interface|type|class|new|true|false|null)\b/gu,
		(match) => ansi(color, '35', match)).replace(/("[^"\n]*"|'[^'\n]*')/gu, (match) => ansi(color, '32', match));
}

function markdown(value: string, options: RenderOptions = {}) {
	const color = options.color === true; let fenced = false;
	return sanitize(value).split('\n').map((line) => {
		if (/^```/u.test(line)) { fenced = !fenced; return ansi(color, '2;33', line); }
		if (fenced) return highlightCode(line, color);
		if (/^#{1,6}\s/u.test(line)) return ansi(color, '1;36', line);
		if (/^\s*>/u.test(line)) return ansi(color, '2;36', line);
		if (/^\s*(?:[-*+] |\d+\. )/u.test(line)) return inlineMarkdown(line, color);
		if (/^\s*\|.*\|\s*$/u.test(line)) return ansi(color, '36', line);
		return inlineMarkdown(line, color);
	}).join('\n');
}

function responseTime(value: unknown) {
	const date = new Date(String(value ?? ''));
	if (!Number.isFinite(date.getTime())) return String(value ?? '');
	return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(date);
}

export function renderCommunicationResponses(result: Record<string, unknown>, options: RenderOptions = {}) {
	const responses = Array.isArray(result.responses) ? result.responses.filter((value) => value && typeof value === 'object') as Record<string, unknown>[] : [];
	const targets = Array.isArray(result.targets) ? result.targets.map((value) => value && typeof value === 'object' ? value as Record<string, unknown> : {}) : [];
	const width = Math.max(48, Math.min(160, Number(options.width) || 100));
	const separator = ansi(options.color === true, '2;36', '═'.repeat(width));
	return responses.map((response) => {
		const target = targets.find((candidate) => candidate.projectId === response.projectId && candidate.agentSlug === response.agentSlug) ?? {};
		const handle = `@${scalar(target.projectSlug ?? response.projectId)}/${scalar(response.agentSlug)}`;
		const heading = `${ansi(options.color === true, '1;36', handle)}   ${ansi(options.color === true, '2', responseTime(response.createdAt))}`;
		return `${heading}\n\n${markdown(String(response.markdown ?? ''), options)}\n\n${separator}`;
	}).join('\n\n\n');
}

function renderLibraryRead(result: Record<string, unknown>, options: RenderOptions = {}) {
	const payload = result.result && typeof result.result === 'object' && !Array.isArray(result.result)
		? result.result as Record<string, unknown> : result;
	const files = Array.isArray(payload.files) ? payload.files : payload.file && typeof payload.file === 'object' ? [payload.file] : [];
	const ref = payload.resolvedRef ?? payload.ref;
	return files.map((value) => {
		const file = value as Record<string, unknown>;
		const source = scalar(file.sourcePath ?? file.path);
		const logical = file.logicalPath && file.logicalPath !== file.sourcePath ? ` (${scalar(file.logicalPath)})` : '';
		const heading = `${ansi(options.color === true, '1;36', source)}${ansi(options.color === true, '2', logical)}`;
		const provenance = ref ? ansi(options.color === true, '2', `Ref: ${scalar(ref)}`) : '';
		return [heading, provenance, '', markdown(String(file.content ?? file.body ?? ''), options)].filter((line, index) => line || index >= 2).join('\n');
	}).join(`\n\n${ansi(options.color === true, '2;36', '═'.repeat(Math.max(48, Math.min(160, Number(options.width) || 100))))}\n\n`);
}

export function renderHumanCommandResult(value: unknown, options: RenderOptions = {}) {
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
	if (path === 'users create' && result) return [
		`User registration accepted for ${scalar(result.email)}.`,
		result.confirmationRequired ? 'Email confirmation is required before login.' : 'The user is ready to log in.',
		result.nextAction ? `Next: ${scalar(result.nextAction)}` : '',
	].filter(Boolean).join('\n');
	if (path === 'auth status' && result) {
		const name = principalName(result.principal);
		const teams = Array.isArray(result.teams) ? result.teams.length : 0;
		return `${name ? `Authenticated as ${name}.` : 'Not authenticated.'}\nTeams available: ${teams}`;
	}
	if (path === 'teams current' && result) { const team = result.team as Record<string, unknown>; return `Active team: ${scalar(team.name)} (${scalar(team.slug)})\nTeam ID: ${scalar(team.id)}`; }
	if (path === 'teams use' && result && result.team) { const team = result.team as Record<string, unknown>; return `Active team set to ${scalar(team.name)} (${scalar(team.slug)}).`; }
	if (path === 'host security initialize' && result) {
		const receipt = result.receipt && typeof result.receipt === 'object' ? result.receipt as Record<string, unknown> : {};
		const sandbox = receipt.sandbox && typeof receipt.sandbox === 'object' ? receipt.sandbox as Record<string, unknown> : {};
		const providerVolume = receipt.providerVolume && typeof receipt.providerVolume === 'object' ? receipt.providerVolume as Record<string, unknown> : {};
		const ready = sandbox.brokerReady === true && receipt.state === 'known-good';
		return [ready ? 'Host security initialized.' : 'Host encryption initialized; sandbox readiness still needs attention.',
			`Encrypted provider volume: ${providerVolume.encrypted === true && result.verified === true ? 'verified' : 'not verified'}`,
			`Recovery bundle: ${result.recoveryBundleVerified === true ? 'verified' : 'not verified'}`,
			`Kata sandbox broker: ${ready ? 'ready' : 'not ready'}`,
			receipt.receiptId ? `Receipt: ${scalar(receipt.receiptId)}` : '',
			ready ? '' : 'Next: run `trsd host sandbox doctor`.',
		].filter(Boolean).join('\n');
	}
	if (path === 'inbox' && result?.interactiveSession === true) return '';
	if (path === 'send' && result) return result.humanStreamed === true || result.interactiveSession === true ? '' : renderCommunicationResponses(result, options);
	if (path === 'library read' && result) return renderLibraryRead(result, options) || 'No file content was returned.';
	const rendered = lines(envelope.result);
	const warnings = Array.isArray(envelope.warnings) && envelope.warnings.length ? [`Warnings: ${envelope.warnings.map(scalar).join('; ')}`] : [];
	const next = Array.isArray(envelope.nextActions) && envelope.nextActions.length ? ['Next actions:', ...envelope.nextActions.map((item) => `- ${scalar(item)}`)] : [];
	return [...rendered, ...warnings, ...next].join('\n') || 'Completed successfully.';
}
