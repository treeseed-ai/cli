import type { DevelopmentRuntime } from '@treeseed/sdk/development';

type Selection = { projectId: string; targetId: string; mode: string };

/** Start selected prerequisites before consumers, regardless of saved UI order. */
export function developmentBootOrder<T extends Selection>(selections: T[], runtimes: DevelopmentRuntime[]): T[] {
	const key = (entry: Selection) => `${entry.projectId}.${entry.targetId}`;
	const selected = new Map(selections.filter(entry => entry.mode !== 'released').map(entry => [key(entry), entry]));
	const ordered: T[] = [], visiting = new Set<string>(), visited = new Set<string>();
	function visit(entry: T): void {
		const id = key(entry);
		if (visited.has(id)) return;
		if (visiting.has(id)) throw new Error(`Development startup dependency cycle at ${id}.`);
		visiting.add(id);
		const target = runtimes.find(runtime => runtime.project.id === entry.projectId)?.targets.find(target => target.id === entry.targetId);
		if (!target) throw new Error(`Development runtime is missing for ${id}.`);
		for (const dependency of target.dependencies) {
			const prerequisite = selected.get(`${dependency.id}.${dependency.target}`);
			if (prerequisite) visit(prerequisite);
		}
		visiting.delete(id); visited.add(id); ordered.push(entry);
	}
	for (const entry of selected.values()) visit(entry);
	return ordered;
}
