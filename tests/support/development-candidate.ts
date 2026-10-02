import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runDevelopment } from '../../src/cli/commands/development.ts';
import { parseInvocation } from '../../src/cli/parser.ts';
import { resolveCommand } from '../../src/cli/registry.ts';
import type { CommandContext } from '../../src/cli/types.ts';

export function candidateFixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'cli-source-closure-'));
	const state = mkdtempSync(resolve(tmpdir(), 'cli-source-state-'));
	const file = resolve(root, 'treeseed.package.yaml');
	writeFileSync(file, `schemaVersion: treeseed.package/v1
development:
  schemaVersion: treeseed.development-runtime/v1
  project: { id: specimen, repository: example/specimen }
  defaults: { restoreOnFailure: true }
  targets:
    - id: package
      kind: package-watch
      platforms: [linux-amd64]
      runtimeRequirements: [node>=22]
      sourceRoots: [src]
      ignoredPaths: [candidate.bin]
      operations:
        verify: { command: node, args: [--import, ${JSON.stringify(import.meta.resolve('tsx'))}, scripts/verify.ts], environment: {}, timeoutSeconds: 60 }
      ready: { kind: marker, path: candidate.bin, timeoutSeconds: 30 }
      outputs: []
      endpoints: []
      dependencies: []
      statePolicy: stateless
      migrationPolicy: none
      secretRefs: {}
      shutdown: { graceSeconds: 30, activeWorkPolicy: block }
      resources: {}
      logs: []
      forbiddenOperations: []
      freeze:
        kind: archive
        operation: { command: node, args: [--import, ${JSON.stringify(import.meta.resolve('tsx'))}, scripts/freeze.ts], environment: {}, timeoutSeconds: 60 }
        artifacts: [candidate.bin]
        contractOperations: []
      promotion: { liveAdmissible: false, candidateRequiresVerification: true }
`);
	mkdirSync(resolve(root, 'scripts'));
	writeFileSync(resolve(root, 'scripts/freeze.ts'), "import { writeFileSync } from 'node:fs'; writeFileSync('candidate.bin', 'sealed');\n");
	writeFileSync(resolve(root, 'scripts/verify.ts'), "import { appendFileSync } from 'node:fs'; appendFileSync('verification.log', 'verified\\n');\n");
	writeFileSync(resolve(root, '.gitignore'), 'verification.log\nignored.bin\n');
	const sessionFile = resolve(root, 'development.session.yaml');
	writeFileSync(sessionFile, 'projects:\n  - manifest: treeseed.package.yaml\n    worktree: .\n    targets: [{ id: package, mode: candidate }]\n');
	const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
	git('init', '-b', 'staging'); git('add', '.');
	git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
	let record: unknown;
	const registrations: unknown[] = [];
	const output: string[] = [];
	const context: CommandContext = { cwd: root, env: { ...process.env, XDG_STATE_HOME: state }, interactiveUi: false, outputFormat: 'json',
		hostInvoke: async (input: { handlerId: string; options: { payload?: unknown } }) => {
			const payload = JSON.parse(String(input.options.payload));
			if (input.handlerId === 'local.dev.session.start') { record = { session: payload.session, runtimes: payload.runtimes }; return record; }
			if (input.handlerId === 'local.dev.status') return record;
			if (input.handlerId === 'local.dev.candidate.register') { registrations.push(payload.candidate); return record; }
			throw new Error(`Unexpected manager boundary ${input.handlerId}`);
		}, write: (value: string) => output.push(value) };
	async function invoke(args: string[]) {
		output.length = 0;
		const selected = resolveCommand(args); assert.ok(selected);
		try { output.push(JSON.stringify({ result: await runDevelopment(parseInvocation(selected.command, [...selected.rest, '--json']), context) })); return 0; }
		catch (error) { output.push(String(error)); return 1; }
	}
	async function tryFreeze() {
		assert.equal(await invoke(['dev', 'session', 'start', sessionFile]), 0, output.join(''));
		return invoke(['dev', 'freeze', '--allow-dirty']);
	}
	return { root, state, git, output, registrations, tryFreeze, tryPlan: () => invoke(['dev', 'session', 'start', file, '--plan']),
		async plan() {
			assert.equal(await invoke(['dev', 'session', 'start', file, '--plan']), 0, output.join(''));
			return JSON.parse(output[0]!).result.session.repositories[0] as { dirty: boolean; dirtyDigest: string | null; commit: string };
		},
		async freeze() {
			assert.equal(await tryFreeze(), 0, output.join(''));
			return JSON.parse(output[0]!).result as { receipt: string };
		}, verify: () => invoke(['dev', 'verify']),
		readReceipt: (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { promotable: boolean; verification: { status: string } },
		close() { rmSync(root, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); },
	};
}
