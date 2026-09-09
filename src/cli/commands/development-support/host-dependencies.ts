import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

type Package = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; treeseed?: { hostRuntimeDependencies?: string[] } };
const read = (root: string): Package => JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** Deployment declares its runtime roots; npm's installed graph supplies their closure. */
export function hostDependencyRoots(worktree: string): string[] {
	const root = realpathSync(worktree), manifest = read(root);
	const names = manifest.treeseed?.hostRuntimeDependencies;
	if (!Array.isArray(names) || !names.length) throw new Error('Deployment must declare hostRuntimeDependencies.');
	const found = new Set<string>();
	function visit(name: string, issuer: string, optional = false) {
		if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(name)) throw new Error('Invalid host runtime dependency name.');
		let cursor = issuer, selected: string | undefined;
		while (cursor === root || cursor.startsWith(root + sep)) {
			const candidate = resolve(cursor, 'node_modules', name);
			if (existsSync(resolve(candidate, 'package.json'))) { selected = candidate; break; }
			cursor = dirname(cursor);
		}
		if (!selected) { if (optional) return; throw new Error(`Host runtime dependency is missing: ${name}`); }
		if (realpathSync(selected) !== selected) throw new Error('Host runtime dependency contains a symbolic link.');
		if (found.has(selected)) return;
		found.add(selected);
		const pkg = read(selected);
		for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dependency, selected, dependency in (pkg.optionalDependencies ?? {}));
	}
	for (const name of names) {
		if (!(name in (manifest.dependencies ?? {}))) throw new Error('Host runtime root must be a production dependency.');
		visit(name, root);
	}
	return [...found].sort();
}
