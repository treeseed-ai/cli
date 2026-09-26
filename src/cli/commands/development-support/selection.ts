import type { DevelopmentRuntime, DevelopmentTarget } from '@treeseed/sdk/development';

export function parseDevelopmentSelection(value: string) {
	const match = /^([a-z][a-z0-9.-]{1,63})\.([a-z][a-z0-9.-]{1,63})=(released|candidate|live)$/u.exec(value);
	if (!match) throw new Error(`Invalid development selection ${value}; expected project.target=mode.`);
	return { projectId: match[1]!, targetId: match[2]!, mode: match[3]! as 'released' | 'candidate' | 'live' };
}

export function selectedDevelopmentTarget(record: unknown, projectId: string, targetId: string) {
	const runtime = (record as { runtimes?: DevelopmentRuntime[] }).runtimes?.find((entry) => entry.project.id === projectId);
	const target = runtime?.targets.find((entry) => entry.id === targetId);
	if (!runtime || !target) throw new Error(`Development target ${projectId}.${targetId} is not part of the current session.`);
	return { runtime, target };
}

export function dependentDevelopmentAction(reaction: DevelopmentTarget['dependencies'][number]['reaction'], target: Pick<DevelopmentTarget, 'kind' | 'operations'>) {
	if (reaction === 'manual') return 'manual' as const;
	if (reaction !== 'rebuild') return 'restart' as const;
	if (target.kind === 'package-watch') return 'package-rebuild' as const;
	if (target.kind === 'rebuild-restart') return 'rebuild-restart' as const;
	return target.operations.build ? 'build-only' as const : 'restart' as const;
}
