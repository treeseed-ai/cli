import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { developmentRuntimeSchema } from '@treeseed/sdk/development';
import { parse as parseYaml } from 'yaml';

export interface ProjectSelection { manifest: string; worktree?: string; targets?: Array<{ id: string; mode: 'released' | 'candidate' | 'live' }> }

function projectSelections(file: string): ProjectSelection[] {
	const root = dirname(file), document = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown>;
	if (document.development) return [{ manifest: file, worktree: root }];
	if (!Array.isArray(document.projects) || document.projects.length === 0) throw new Error('Development session manifest requires a non-empty projects array.');
	return document.projects.map((project) => {
		if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Development project selection must be an object.');
		const input = project as Record<string, unknown>;
		if (typeof input.manifest !== 'string') throw new Error('Development project selection requires a manifest path.');
		const manifest = isAbsolute(input.manifest) ? input.manifest : resolve(root, input.manifest);
		const worktree = typeof input.worktree === 'string' ? (isAbsolute(input.worktree) ? input.worktree : resolve(root, input.worktree)) : dirname(manifest);
		return { manifest, worktree, ...(Array.isArray(input.targets) ? { targets: input.targets as ProjectSelection['targets'] } : {}) };
	});
}

async function sourceSchema(selections: ProjectSelection[], prepare: boolean) {
	const sdk = selections.find((selection) => {
		const document = parseYaml(readFileSync(selection.manifest, 'utf8')) as { development?: { project?: { id?: unknown; repository?: unknown } } };
		return document.development?.project?.id === 'sdk' && document.development.project.repository === 'treeseed-ai/sdk';
	});
	if (!sdk) return developmentRuntimeSchema;
	const worktree = sdk.worktree ?? dirname(sdk.manifest), packagePath = resolve(worktree, 'package.json');
	const packageDocument = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown; scripts?: { ['build:dist']?: unknown } };
	if (packageDocument.name !== '@treeseed/sdk' || typeof packageDocument.scripts?.['build:dist'] !== 'string') throw new Error('The selected SDK source is not a buildable @treeseed/sdk worktree.');
	if (prepare) {
		const result = spawnSync('npm', ['run', 'build:dist'], { cwd: worktree, env: process.env, stdio: 'inherit', timeout: 900_000 });
		if (result.status !== 0) throw new Error('The selected SDK source contract could not be built.');
	}
	const entrypoint = resolve(worktree, 'dist/development/index.js');
	if (!existsSync(entrypoint)) throw new Error('The selected SDK source contract is not built. Run development session start without --plan to prepare it.');
	const module = await import(`${pathToFileURL(entrypoint).href}?source=${statSync(entrypoint).mtimeMs}`) as { developmentRuntimeSchema?: typeof developmentRuntimeSchema };
	if (!module.developmentRuntimeSchema?.parse) throw new Error('The selected SDK source does not export its development runtime contract.');
	return module.developmentRuntimeSchema;
}

export async function loadDevelopmentRuntimes(file: string, prepareLocalSdk = false) {
	const selections = projectSelections(file), schema = await sourceSchema(selections, prepareLocalSdk);
	return selections.map((selection) => {
		const document = parseYaml(readFileSync(selection.manifest, 'utf8')) as { development?: unknown };
		return { selection, runtime: schema.parse(document.development) };
	});
}
