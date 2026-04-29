import { Box, render, Text, useApp, useWindowSize } from 'ink';
import React from 'react';
import type { TreeseedCommandContext } from '../types.js';
import { truncateLine, wrapText } from '../ui/framework.js';

type Scope = 'local' | 'staging' | 'prod';

type StatusState = Record<string, any>;

const SCOPES: Array<{ id: Scope; label: string }> = [
	{ id: 'local', label: 'Local' },
	{ id: 'staging', label: 'Staging' },
	{ id: 'prod', label: 'Production' },
];

function statusTone(ok: boolean, warnings = 0) {
	if (!ok) return 'red';
	if (warnings > 0) return 'yellow';
	return 'green';
}

function yesNo(value: boolean) {
	return value ? 'yes' : 'no';
}

function providerText(provider: Record<string, any> | undefined) {
	if (!provider) return 'unknown';
	if (provider.applicable === false) return provider.detail ?? 'not applicable';
	const base = provider.configured ? 'configured' : 'missing';
	if (!provider.live) return base;
	if (provider.live.skipped) return `${base} / ${provider.live.detail}`;
	return `${base} / ${provider.live.ready ? 'live ok' : 'live failed'}`;
}

function providerColor(provider: Record<string, any> | undefined) {
	if (provider?.applicable === false) return 'gray';
	if (!provider?.configured) return 'red';
	if (provider.live && !provider.live.ready && !provider.live.skipped) return 'red';
	if (provider.live?.skipped) return 'yellow';
	return 'green';
}

function envRows(state: StatusState, scope: Scope, width: number) {
	const env = state.environmentStatus?.[scope] ?? state.persistentEnvironments?.[scope] ?? {};
	const readiness = state.readiness?.[scope] ?? {};
	const provider = state.providerStatus?.[scope] ?? {};
	const blockers = Array.isArray(env.blockers) ? env.blockers : readiness.blockers ?? [];
	const warnings = Array.isArray(env.warnings) ? env.warnings : readiness.warnings ?? [];
	const providerRows: Array<{ label: string; value: string; color?: string }> = [
		{ label: 'GitHub', value: providerText(provider.github), color: providerColor(provider.github) },
		{ label: 'Cloudflare', value: providerText(provider.cloudflare), color: providerColor(provider.cloudflare) },
		{ label: 'Railway', value: providerText(provider.railway), color: providerColor(provider.railway) },
	];
	if (scope === 'local') {
		providerRows.push({ label: 'Local dev', value: providerText(provider.localDevelopment), color: providerColor(provider.localDevelopment) });
	}
	const rows: Array<{ label: string; value: string; color?: string }> = [
		{ label: 'Phase', value: env.phase ?? 'pending', color: statusTone(Boolean(env.ready), warnings.length) },
		{ label: 'Ready', value: yesNo(Boolean(env.ready)), color: statusTone(Boolean(env.ready), warnings.length) },
		{ label: 'Configured', value: yesNo(Boolean(env.configured)), color: env.configured ? 'green' : 'yellow' },
		{ label: 'Initialized', value: yesNo(Boolean(env.initialized)), color: env.initialized ? 'green' : 'yellow' },
		{ label: 'Provisioned', value: yesNo(Boolean(env.provisioned)), color: scope === 'local' || env.provisioned ? 'green' : 'yellow' },
		{ label: 'Deployable', value: yesNo(Boolean(env.deployable)), color: env.deployable ? 'green' : 'yellow' },
		...providerRows,
		{ label: 'Last deploy', value: env.lastDeploymentTimestamp ?? '(none)', color: env.lastDeploymentTimestamp ? 'white' : 'gray' },
		{ label: 'URL', value: env.lastDeployedUrl ?? '(none)', color: env.lastDeployedUrl ? 'cyan' : 'gray' },
	];
	const issueRows = [
		...blockers.slice(0, 4).map((value: string) => ({ label: 'Blocker', value, color: 'red' })),
		...warnings.slice(0, 3).map((value: string) => ({ label: 'Warning', value, color: 'yellow' })),
	];
	return [...rows, ...issueRows].flatMap((row) => {
		const prefix = `${row.label}: `;
		const wrapped = wrapText(String(row.value), Math.max(1, width - prefix.length));
		return wrapped.map((line, index) => ({
			text: index === 0 ? `${prefix}${line}` : `${' '.repeat(prefix.length)}${line}`,
			color: row.color,
		}));
	});
}

function SummaryPanel(props: { state: StatusState; width: number }) {
	const state = props.state;
	const packageBlockers = state.packageSync?.blockers ?? [];
	const workflowBlockers = state.workflowControl?.blockers ?? [];
	const rows = [
		{ label: 'Workspace', value: state.workspaceRoot ? state.cwd : '(not a workspace)', color: state.workspaceRoot ? 'green' : 'red' },
		{ label: 'Branch', value: `${state.branchName ?? '(none)'} (${state.branchRole})`, color: state.dirtyWorktree ? 'yellow' : 'green' },
		{ label: 'Environment', value: state.environment, color: state.environment === 'none' ? 'yellow' : 'cyan' },
		{ label: 'Worktree', value: state.dirtyWorktree ? 'dirty' : 'clean', color: state.dirtyWorktree ? 'yellow' : 'green' },
		{ label: 'Packages', value: `${state.packageSync?.mode ?? 'unknown'} / ${state.packageSync?.dependencyMode ?? 'unknown'}`, color: packageBlockers.length > 0 ? 'red' : 'green' },
		{ label: 'Workflow', value: workflowBlockers.length > 0 ? workflowBlockers.join(' | ') : 'no active blockers', color: workflowBlockers.length > 0 ? 'red' : 'green' },
		{ label: 'Secrets', value: state.secrets?.keyAgentRunning ? (state.secrets.keyAgentUnlocked ? 'agent unlocked' : 'agent locked') : 'agent stopped', color: state.secrets?.keyAgentUnlocked ? 'green' : 'yellow' },
		{ label: 'Market', value: state.marketConnection?.projectSlug ?? state.marketConnection?.projectId ?? '(not paired)', color: state.marketConnection?.configured ? 'green' : 'gray' },
	];
	return React.createElement(
		Box,
		{ flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', width: props.width, paddingX: 1 },
		React.createElement(Text, { color: 'cyan', bold: true }, truncateLine('Project Status', props.width - 4)),
		...rows.map((row) => React.createElement(
			Text,
			{ key: row.label, color: row.color },
			truncateLine(`${row.label}: ${row.value}`, props.width - 4),
		)),
	);
}

function EnvironmentPanel(props: { state: StatusState; scope: Scope; label: string; width: number }) {
	const env = props.state.environmentStatus?.[props.scope] ?? {};
	const blockers = env.blockers ?? [];
	const warnings = env.warnings ?? [];
	const rows = envRows(props.state, props.scope, props.width - 4);
	return React.createElement(
		Box,
		{ flexDirection: 'column', borderStyle: 'round', borderColor: statusTone(Boolean(env.ready), warnings.length), width: props.width, paddingX: 1 },
		React.createElement(Text, { color: statusTone(Boolean(env.ready), warnings.length), bold: true }, truncateLine(`${props.label}  ${blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready'}`, props.width - 4)),
		...rows.slice(0, 18).map((row, index) => React.createElement(
			Text,
			{ key: `${props.scope}-${index}`, color: row.color ?? 'white' },
			truncateLine(row.text, props.width - 4),
		)),
	);
}

function ServicesPanel(props: { state: StatusState; width: number }) {
	const services = Object.entries(props.state.managedServices ?? {});
	const nextSteps = Array.isArray(props.state.recommendations) ? props.state.recommendations : [];
	const serviceRows = services.length > 0
		? services.map(([key, service]: [string, any]) => `${key}: ${service.enabled ? (service.initialized ? 'deployed' : 'not deployed') : 'disabled'}${service.lastDeployedUrl ? ` (${service.lastDeployedUrl})` : ''}`)
		: ['(none)'];
	const nextRows = nextSteps.length > 0
		? nextSteps.map((step: any) => `${step.operation}: ${step.reason ?? ''}`)
		: ['No next steps.'];
	return React.createElement(
		Box,
		{ flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', width: props.width, paddingX: 1 },
		React.createElement(Text, { color: 'yellow', bold: true }, truncateLine('Services and Next Steps', props.width - 4)),
		...serviceRows.slice(0, 6).map((line, index) => React.createElement(Text, { key: `svc-${index}`, color: line.includes('not deployed') ? 'yellow' : line.includes('disabled') ? 'gray' : 'green' }, truncateLine(line, props.width - 4))),
		...nextRows.slice(0, 4).map((line, index) => React.createElement(Text, { key: `next-${index}`, color: 'cyan' }, truncateLine(`Next: ${line}`, props.width - 4))),
	);
}

function StatusDashboard(props: { state: StatusState }) {
	const { exit } = useApp();
	const windowSize = useWindowSize();
	const width = Math.max(72, windowSize?.columns ?? 100);
	const stacked = width < 118;
	const columnWidth = stacked ? width : Math.max(28, Math.floor((width - 2) / 3));
	React.useEffect(() => {
		const timer = setTimeout(() => exit(), 20);
		return () => clearTimeout(timer);
	}, [exit]);
	return React.createElement(
		Box,
		{ flexDirection: 'column', width },
		React.createElement(SummaryPanel, { state: props.state, width }),
		React.createElement(
			Box,
			{ flexDirection: stacked ? 'column' : 'row', width },
			...SCOPES.map((scope) => React.createElement(EnvironmentPanel, {
				key: scope.id,
				state: props.state,
				scope: scope.id,
				label: scope.label,
				width: columnWidth,
			})),
		),
		React.createElement(ServicesPanel, { state: props.state, width }),
	);
}

export async function renderTreeseedStatusInk(state: StatusState, context: Pick<TreeseedCommandContext, 'outputFormat' | 'interactiveUi'> = {}) {
	if (context.outputFormat === 'json' || context.interactiveUi === false || !process.stdout.isTTY) {
		return false;
	}
	const instance = render(React.createElement(StatusDashboard, { state }), { exitOnCtrlC: false });
	await instance.waitUntilExit();
	return true;
}
