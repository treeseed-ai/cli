import { MarketClientError } from '@treeseed/sdk/market-client';
import { fail } from '../../utilities/utils.js';

const FORBIDDEN_OUTPUT_FIELDS = new Set([
	'capacityProviderId',
	'grantId',
	'workerPoolId',
	'runtimeHostId',
	'runnerToken',
]);

export function projectUsage(action: string) {
	return action === 'access'
		? 'Usage: treeseed projects access <project-id>'
		: 'Usage: treeseed projects [list|access]';
}

export function authFailure(error: unknown) {
	if (error instanceof MarketClientError && [401, 403].includes(error.status)) return fail(error.message, 2);
	const message = error instanceof Error ? error.message : String(error);
	return /not logged in|unauthori[sz]ed|forbidden/iu.test(message) ? fail(message, 2) : null;
}

export function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => redact(item));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([key]) => !FORBIDDEN_OUTPUT_FIELDS.has(key))
		.filter(([key]) => !/(?:secret|token|password|apiKey|privateKey)/iu.test(key))
		.map(([key, entry]) => [key, redact(entry)]));
}

export function architectureSummary(project: any) {
	const architecture = project?.architecture ?? project?.metadata?.architecture;
	if (!architecture || typeof architecture !== 'object') return 'architecture=(not recorded)';
	return [
		`topology=${architecture.topology ?? 'unknown'}`,
		`site=${architecture.sitePath ?? '.'}`,
		`content=${architecture.contentPath ?? '(none)'}`,
		`runtime=${architecture.contentRuntimeSource ?? 'unknown'}`,
	].join(' ');
}
