import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { DevelopmentRuntime } from '@treeseed/sdk/development';
import { developmentStateRoot } from '../development-cli-selection.js';
import { developmentBootOrder } from './boot-order.js';

export function repositoryClosure(runtime: DevelopmentRuntime, worktree: string, excludedPaths: string[] = []) {
	const git = (args: string[]) => execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
	if(realpathSync(git(['rev-parse','--show-toplevel']))!==realpathSync(worktree)) throw new Error('Development closure requires its own exact Git source root.');
	const pathspec = excludedPaths.length ? ['--', '.', ...excludedPaths.map(path => `:(exclude,literal)${path}`)] : [];
	const status = git(['status', '--porcelain=v1', '--untracked-files=all', ...pathspec]);
	const digest = createHash('sha256').update(`${status}\n${git(['diff', '--binary', 'HEAD', ...pathspec])}`);
	// Git diff omits untracked bytes. NUL-delimited native discovery also preserves
	// filenames containing whitespace/newlines, without parsing porcelain quoting.
	for (const name of git(['ls-files', '--others', '--exclude-standard', '-z', ...pathspec]).split('\0').filter(Boolean)) {
		const path = resolve(worktree, name), metadata = lstatSync(path);
		let bytes: Buffer, mode: number;
		if (metadata.isSymbolicLink()) { bytes = Buffer.from(readlinkSync(path)); mode = 0o120000; }
		else {
			const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
			try {
				const opened = fstatSync(descriptor);
				if (!opened.isFile()) throw new Error('Development source requires readable regular files or Git symbolic links.');
				bytes = readFileSync(descriptor); mode = opened.mode & 0o111 ? 0o100755 : 0o100644;
			} finally { closeSync(descriptor); }
		}
		digest.update(JSON.stringify([name, mode, bytes.length])).update('\0').update(bytes);
	}
	return { projectId: runtime.project.id, repository: runtime.project.repository, worktree,
		commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']) || null, dirty: Boolean(status),
		dirtyDigest: status ? `sha256:${digest.digest('hex')}` : null,
		recipeDigest: `sha256:${createHash('sha256').update(JSON.stringify(runtime)).digest('hex')}` };
}

export function artifactPaths(pattern: string, root: string) {
	if (!pattern.includes('*')) return [resolve(root, pattern)];
	const directory = resolve(root, dirname(pattern)), expression = new RegExp(`^${basename(pattern).replaceAll('.', '\\.').replaceAll('*', '.*')}$`, 'u');
	return readdirSync(directory).filter((name) => expression.test(name)).map((name) => resolve(directory, name));
}

/** A declared relative command directory must remain within its canonical owner. */
export function developmentOperationDirectory(root:string,cwd?:string) {
	try {
		const owner=realpathSync(root),directory=realpathSync(resolve(root,cwd??'.')),inside=relative(owner,directory);
		if(inside==='..'||inside.startsWith('../')||isAbsolute(inside)||!lstatSync(directory).isDirectory()) throw new Error('Invalid command directory.');
		return directory;
	} catch {throw new Error('Development command working directory custody requires a directory inside its exact owner.');}
}

/** Resolve aliases only within the owning repository; inspect the opened bytes. */
export function readDevelopmentArtifact(root:string,path:string) {
	let descriptor:number|undefined;
	try {
		const owner=realpathSync(root),identity=relative(resolve(root),resolve(path)),actual=realpathSync(path),inside=relative(owner,actual);
		if(identity==='..'||identity.startsWith('../')||isAbsolute(identity)||inside==='..'||inside.startsWith('../')||isAbsolute(inside)) throw new Error('Artifact escaped its owner.');
		const selected=lstatSync(actual);
		descriptor=openSync(actual,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
		const before=fstatSync(descriptor);
		if(!before.isFile()||(before.mode&0o444)===0||before.ino!==selected.ino||before.dev!==selected.dev) throw new Error('Artifact is not readable regular bytes.');
		const bytes=readFileSync(descriptor),after=fstatSync(descriptor),current=lstatSync(actual);
		if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs
			||current.ino!==after.ino||current.dev!==after.dev||realpathSync(path)!==actual||realpathSync(root)!==owner) throw new Error('Artifact changed while reading.');
		return bytes;
	} catch {throw new Error('Development artifact custody failed: unchanged readable regular bytes inside its owner are required.');}
	finally {if(descriptor!==undefined)closeSync(descriptor);}
}

/** Narrow only explicit roots; retain every declared dependency and its source. */
export function developmentFreezeClosure<T extends { session: { repositories: Array<{projectId:string;worktree:string}>; targets: Array<{projectId:string;targetId:string;mode:string;generation:number}> }; runtimes: DevelopmentRuntime[] }>(record:T, input:unknown):T {
	if (input === undefined) return record;
	if (!Array.isArray(input) || !input.length || input.some(key => typeof key !== 'string' || !/^[a-z0-9-]+\.[a-z0-9-]+$/u.test(key))
		|| new Set(input).size !== input.length) throw new Error('Development freeze target roots must be nonempty unique exact project.target identities.');
	const contracts = new Map<string, DevelopmentRuntime['targets'][number]>(record.runtimes.flatMap(runtime => runtime.targets.map(target => [`${runtime.project.id}.${target.id}`, target] as const)));
	const selections = new Map<string, T['session']['targets'][number]>(record.session.targets.map(target => [`${target.projectId}.${target.targetId}`, target] as const));
	if (contracts.size !== record.runtimes.reduce((count,runtime) => count + runtime.targets.length,0)
		|| selections.size !== record.session.targets.length) throw new Error('Development freeze target authority is ambiguous.');
	const keys = new Set<string>(), visiting = new Set<string>();
	const visit = (key:string) => {
		if (visiting.has(key)) throw new Error('Development freeze dependency cycle is unresolved.');
		if (keys.has(key)) return;
		const target = contracts.get(key), selected = selections.get(key);
		if (!target || !selected) throw new Error(`Development freeze dependency authority is missing for ${key}.`);
		visiting.add(key);
		for (const dependency of target.dependencies) visit(`${dependency.id}.${dependency.target}`);
		visiting.delete(key); keys.add(key);
	};
	for (const key of input) {
		const selected = selections.get(key), target = contracts.get(key);
		if (!selected || selected.mode === 'released' || !target?.freeze) throw new Error(`Development freeze target is unavailable: ${key}.`);
		visit(key);
	}
	const projects = new Set([...keys].map(key => selections.get(key)!.projectId));
	for (const project of projects) if (record.session.repositories.filter(source => source.projectId === project).length !== 1)
		throw new Error(`Development freeze dependency source is missing or ambiguous for ${project}.`);
	return { ...record, session: { ...record.session,
		targets: [...keys].map(key => selections.get(key)!), repositories: record.session.repositories.filter(source => projects.has(source.projectId)) } };
}

/** Bind the original dependency order to each owning freeze operation. */
export function developmentFreezeTargets(record: Parameters<typeof freezeCustody>[0]) {
	return developmentBootOrder(record.session.targets, record.runtimes).flatMap(selected => {
		const runtime = record.runtimes.find(runtime => runtime.project.id === selected.projectId)!;
		const target = runtime.targets.find(target => target.id === selected.targetId)!;
		return target.freeze ? [{ runtime, target: { ...target, freeze: target.freeze }, mode: selected.mode }] : [];
	});
}

export function assertDevelopmentGenerations(generations: Record<string,number>, targets: Array<{projectId:string;targetId:string;generation:number}>) {
	for (const [key,generation] of Object.entries(generations)) {
		const selected = targets.filter(target => `${target.projectId}.${target.targetId}` === key);
		if (selected.length !== 1 || selected[0]!.generation !== generation) throw new Error(`Candidate dependency generation changed after freeze: ${key}.`);
	}
}

/** Build outputs may change; the source closure and already captured artifacts may not. */
export function freezeCustody(record:{session:{repositories:Array<{projectId:string;worktree:string}>;targets:Array<{projectId:string;targetId:string;mode:string}>};runtimes:DevelopmentRuntime[]}) {
	const directories:Array<{root:string;cwd?:string;directory:string}>=[];
	for(const runtime of record.runtimes)for(const target of runtime.targets)if(target.freeze&&record.session.targets.some(selected=>selected.projectId===runtime.project.id&&selected.targetId===target.id&&selected.mode!=='released')) {
		const repository=record.session.repositories.find(entry=>entry.projectId===runtime.project.id);
		if(!repository)throw new Error(`Development runtime source is missing for ${runtime.project.id}.`);
		for(const operation of [target.freeze.operation,...target.freeze.contractOperations])directories.push({root:repository.worktree,cwd:operation.cwd,directory:developmentOperationDirectory(repository.worktree,operation.cwd)});
	}
	const capture=()=>{
		for(const entry of directories)if(developmentOperationDirectory(entry.root,entry.cwd)!==entry.directory)throw new Error('Development command working directory custody changed during freeze.');
		return record.session.repositories.map(repository=>{
		const runtime=record.runtimes.find(entry=>entry.project.id===repository.projectId);
		if(!runtime) throw new Error(`Development runtime is missing for ${repository.projectId}.`);
		const outputs=runtime.targets.filter(target=>target.freeze&&record.session.targets.some(selected=>selected.projectId===runtime.project.id&&selected.targetId===target.id&&selected.mode!=='released'))
			.flatMap(target=>target.freeze!.artifacts.flatMap(pattern=>pattern.includes('*')&&!existsSync(resolve(repository.worktree,dirname(pattern)))?[]:artifactPaths(pattern,repository.worktree)))
			.map(path=>{
				const identity=relative(repository.worktree,path);
				if(identity.startsWith('..')||isAbsolute(identity)) throw new Error('Freeze artifact identity escapes its source repository.');
				return identity;
			});
		return repositoryClosure(runtime,repository.worktree,outputs);
		});
	};
	const source=capture();
	return {source,assert(artifacts:Array<{projectId:string;identity:string;digest:string}>) {
		const current=capture();
		for(const [index,entry] of source.entries()) if(JSON.stringify(current[index])!==JSON.stringify(entry)) throw new Error(`Candidate source changed during freeze: ${entry.projectId}.`);
		for(const artifact of artifacts) {
			const repository=record.session.repositories.find(entry=>entry.projectId===artifact.projectId)!;
			const path=resolve(repository.worktree,artifact.identity);
			if(!existsSync(path)||`sha256:${createHash('sha256').update(readDevelopmentArtifact(repository.worktree,path)).digest('hex')}`!==artifact.digest) throw new Error(`Candidate artifact changed during freeze: ${artifact.identity}.`);
		}
	}};
}

export function compatibilityAttestations(repositories: Array<{ worktree: string }>) {
	return repositories.flatMap(({ worktree }) => {
		const path = resolve(worktree, '.treeseed/standards/compatibility-attestation.json');
		if (!existsSync(path)) return [];
		const bytes = readFileSync(path), value = JSON.parse(bytes.toString('utf8')) as { contractId?: unknown; result?: { sufficient?: unknown; required?: unknown } };
		if (typeof value.contractId !== 'string' || value.result?.sufficient !== true || !['none', 'patch', 'minor', 'major'].includes(String(value.result?.required))) throw new Error(`Compatibility attestation is invalid or insufficient: ${path}.`);
		return [{ contractId: value.contractId, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, compatible: true, minimumBump: value.result.required as 'none' | 'patch' | 'minor' | 'major' }];
	});
}

export function withFreezeLock<T>(env: NodeJS.ProcessEnv, sessionId: string, action: () => Promise<T>) {
	const lock = resolve(developmentStateRoot(env), sessionId, 'freeze.lock');
	mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
	let descriptor: number;
	try { descriptor = openSync(lock, 'wx', 0o600); } catch { throw new Error(`Candidate freeze is already active for ${sessionId}.`); }
	return action().finally(() => { closeSync(descriptor); rmSync(lock, { force: true }); });
}
