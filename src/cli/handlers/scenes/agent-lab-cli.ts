import { spawn } from 'node:child_process';
import {
	createProductionAgentLabExecutor,
	validateScene,
	type AgentLabPresentation,
	type SceneManifest,
} from '@treeseed/sdk/scenes';
import { collectConfigSeedValues } from '@treeseed/sdk/workflow-support';
import type { ParsedInvocation } from '../../types.ts';

function values(value: unknown) {
	const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
	return [...new Set(entries.flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean))];
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function openReport(url: string) {
	const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const child = spawn(command, args, { detached: true, stdio: 'ignore' });
	child.unref();
}

export async function resolveAgentLabSceneRun(input: {
	projectRoot: string;
	scene: string;
	invocation: ParsedInvocation;
	env: Record<string, string | undefined>;
}) {
	const validation = validateScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.scene?.agentLab || validation.scene.journey?.kind !== 'agent-lab') return {};
	const scene = structuredClone(validation.scene) as SceneManifest;
	const lab = scene.agentLab!;
	const agentTests = values(input.invocation.args.agentTest);
	const projects = values(input.invocation.args.project);
	const agents = values(input.invocation.args.agent);
	const agentClasses = values(input.invocation.args.agentClass);
	const presentation = stringValue(input.invocation.args.presentation);
	const timeZone = stringValue(input.invocation.args.timeZone);
	if (agentTests.length) lab.workdays = lab.workdays.map((workday) => ({ ...workday, agentTests }));
	if (projects.length) lab.repositories = projects;
	if (agents.length) lab.agents = agents;
	if (agentClasses.length) lab.agentClasses = agentClasses;
	if (presentation) lab.presentation = presentation as AgentLabPresentation;
	if (timeZone) {
		new Intl.DateTimeFormat('en-US', { timeZone }).format();
		lab.timeZone = timeZone;
	}
	const resolvedEnv = { ...input.env, ...collectConfigSeedValues(input.projectRoot, 'local', input.env) };
	const { executeLiveCapacityAcceptance } = await import('@treeseed/agent/provider-acceptance');
	return {
		scene,
		agentLabExecutor: createProductionAgentLabExecutor({
			env: resolvedEnv,
			assignmentExecutor: (executionInput) => executeLiveCapacityAcceptance({
				...executionInput, cwd: input.projectRoot, env: resolvedEnv,
			}),
		}),
		onAgentLabReportReady: ({ url }: { url: string }) => {
			process.stderr.write(`[agent-lab] Live report: ${url}\n`);
			if (input.invocation.args.open === true) openReport(url);
		},
	};
}
