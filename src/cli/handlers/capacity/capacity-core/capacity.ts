import { runScene,type SceneManifest } from '@treeseed/sdk/scenes';
import type { CommandHandler,ParsedInvocation } from '../../../types.js';
import { guidedResult } from '../../utilities/utils.js';
import { resolveAgentLabSceneRun } from '../../scenes/agent-lab-cli.js';
import { CAPACITY_MARKET_INSPECTION_ACTIONS } from './capacity-market-inspection.js';
import { capacityFlagArg,capacityPositiveNumberArg,capacityStringArg } from './capacity-command-arguments.js';
import { PROVIDER_ENTRYPOINT_ACTIONS,PROVIDER_LIFECYCLE_ACTIONS } from './capacity-runtime.js';
import { routeCapacityAction } from './routing/capacity-action-router.js';

export { PROVIDER_ENTRYPOINT_ACTIONS,PROVIDER_LIFECYCLE_ACTIONS } from './capacity-runtime.js';
export const MARKET_INSPECTION_ACTIONS = new Set([...CAPACITY_MARKET_INSPECTION_ACTIONS, 'execution-runs', 'workday-log', 'workday-run']);

function compatibilityInvocation(invocation: ParsedInvocation): ParsedInvocation {
	return {
		...invocation,
		args: {
			...invocation.args,
			agentTest: invocation.args.agentTest ?? 'guide-editorial-cycle',
			project: invocation.args.projects ?? invocation.args.project ?? 'market',
			agent: invocation.args.agents ?? invocation.args.agent,
			agentClass: invocation.args.agentClasses ?? invocation.args.agentClass,
			presentation: invocation.args.presentation ?? 'race-control',
			timeZone: invocation.args.timeZone,
		},
	};
}

function expandWorkdays(scene: SceneManifest, invocation: ParsedInvocation) {
	const count = capacityPositiveNumberArg(invocation, 'workdays', 1);
	if (!Number.isInteger(count)) throw new Error('--workdays must be a positive integer.');
	const durationSeconds = capacityPositiveNumberArg(invocation, 'durationSeconds', 1800);
	const availableCredits = capacityPositiveNumberArg(invocation, 'availableCredits', 64);
	const maxActiveAssignments = capacityPositiveNumberArg(invocation, 'maxActiveAssignments', 4);
	const source = scene.agentLab!.workdays[0]!;
	scene.agentLab!.workdays = Array.from({ length: count }, (_, index) => ({
		...source,
		id: count === 1 ? source.id : `${source.id}-${index + 1}`,
		title: count === 1 ? source.title : `${source.title ?? source.id} · Workday ${index + 1}`,
		durationSeconds,
		availableCredits,
		maxActiveAssignments,
	}));
	return scene;
}

async function runWorkdayScene(invocation: ParsedInvocation, context: Parameters<CommandHandler>[1]) {
	if (!capacityFlagArg(invocation, 'execute')) {
		return guidedResult({
			command: 'capacity workday-run',
			summary: 'Production workdays now run through the canonical Agent Lab scene.',
			facts: [{ label: 'Preview', value: 'trsd scene plan guide-agent-lab --json' }],
			sections: [{ title: 'Run', lines: ['Add --execute to launch isolated real Codex workdays and the live HTML report.'] }],
			exitCode: 0,
			report: { delegatedScene: 'guide-agent-lab', executionRequired: true },
		});
	}
	const mapped = compatibilityInvocation(invocation);
	const resolved = await resolveAgentLabSceneRun({ projectRoot: context.cwd, scene: 'guide-agent-lab', invocation: mapped, env: context.env });
	const scene = expandWorkdays(structuredClone(resolved.scene!) as SceneManifest, invocation);
	const report = await runScene({
		projectRoot: context.cwd,
		scene,
		agentLabExecutor: resolved.agentLabExecutor,
		onAgentLabReportReady: resolved.onAgentLabReportReady,
		onProgress: context.outputFormat === 'json' ? undefined : (event) => context.write(`[agent-lab] ${event.type}\n`, 'stderr'),
	});
	return guidedResult({
		command: 'capacity workday-run',
		summary: report.ok ? `Agent Lab completed ${scene.agentLab!.workdays.length} production workday(s).` : 'Agent Lab production workday execution failed.',
		facts: [
			{ label: 'Scene', value: report.sceneId ?? 'guide-agent-lab' },
			{ label: 'Run', value: report.runId ?? 'unavailable' },
			{ label: 'Workdays', value: scene.agentLab!.workdays.length },
			{ label: 'HTML report', value: report.artifacts?.htmlReportPath ?? 'unavailable' },
		],
		sections: report.ok ? [] : [{ title: 'Diagnostics', lines: report.diagnostics.map((entry) => entry.message) }],
		exitCode: report.ok ? 0 : 1,
		report: { delegatedScene: 'guide-agent-lab', sceneReport: report },
	});
}

export const handleCapacity: CommandHandler = async (invocation, context) => {
	const action = invocation.positionals[0] ?? 'doctor';
	return routeCapacityAction(action, invocation, context, runWorkdayScene);
};
