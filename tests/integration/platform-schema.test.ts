import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCommandLine } from '../../src/cli/runtime.ts';
import { platformSchemaFixture } from '../support/architecture/platform-schema.ts';

type Envelope = { ok: boolean; error: { code: string } | null;
	result: { ok: boolean; digest: string; diagnostics: { path: string }[] } };
async function verify(root: string) {
	const output: string[] = [];
	const exit = await runCommandLine(['platform', 'verify', '--json'], {
		cwd: root, interactiveUi: false, write: value => output.push(value),
	});
	assert.equal(output.length, 1, 'Public CLI must emit one canonical envelope');
	return { exit, envelope: JSON.parse(output[0]!) as Envelope };
}

test('public CLI accepts exact canonical schema without changing Git or input bytes', async () => {
	const fixture = platformSchemaFixture();
	try {
		const commit = fixture.git('rev-parse', 'HEAD');
		const result = await verify(fixture.root);
		assert.equal(fixture.git('rev-parse', 'HEAD'), commit);
		assert.equal(readFileSync(resolve(fixture.root, 'docs/agent.schema.yml'), 'utf8'), fixture.bytes);
		assert.equal(result.exit, 0);
		assert.equal(result.envelope.ok, true);
		assert.deepEqual(result.envelope.result.diagnostics, []);
	} finally { fixture.close(); }
});

test('public CLI rejects every committed unconstrained canonical definition with local policy evidence', async () => {
	const fixture = platformSchemaFixture();
	try {
		let previous = await verify(fixture.root);
		let commit = fixture.git('rev-parse', 'HEAD');
		const missed: string[] = [];
		for (const name of Object.keys(fixture.document.$defs)) {
			const document = structuredClone(fixture.document);
			document.$defs[name] = true;
			fixture.commit(document);
			const selected = fixture.git('rev-parse', 'HEAD');
			const result = await verify(fixture.root);
			assert.notEqual(selected, commit);
			assert.notEqual(result.envelope.result.digest, previous.envelope.result.digest);
			if (result.exit !== 1 || result.envelope.ok !== false
				|| result.envelope.error?.code !== 'platform_verification_failed'
				|| !result.envelope.result.diagnostics.some(entry => entry.path === 'docs/agent.schema.yml')) missed.push(name);
			previous = result;
			commit = selected;
		}
		assert.deepEqual(missed, []);
	} finally { fixture.close(); }
});

test('public CLI rejects incomplete duplicate and runtime-only canonical stored-record unions', async () => {
	const fixture = platformSchemaFixture();
	try {
		const variants = [
			fixture.document.oneOf.slice(1),
			[...fixture.document.oneOf, structuredClone(fixture.document.oneOf[0]!)],
			[...fixture.document.oneOf, { $ref: '#/$defs/AssignmentContext' }],
		];
		const missed: number[] = [];
		for (const [index, oneOf] of variants.entries()) {
			fixture.commit({ ...structuredClone(fixture.document), oneOf });
			const result = await verify(fixture.root);
			if (result.exit !== 1 || result.envelope.error?.code !== 'platform_verification_failed') missed.push(index);
		}
		assert.deepEqual(missed, []);
	} finally { fixture.close(); }
});

test('public CLI denies untracked canonical authority instead of silently omitting it', async () => {
	const fixture = platformSchemaFixture();
	try {
		fixture.git('rm', '--cached', '--', 'docs/agent.schema.yml');
		assert.equal(readFileSync(resolve(fixture.root, 'docs/agent.schema.yml'), 'utf8'), fixture.bytes);
		const result = await verify(fixture.root);
		assert.equal(result.exit, 1);
		assert.equal(result.envelope.ok, false);
		assert.equal(result.envelope.error?.code, 'platform_verification_failed');
	} finally { fixture.close(); }
});

for (const changed of [false, true]) {
	test(`native CLI entrypoint ${changed ? 'denies changed assignment authority' : 'accepts the exact canonical declaration'}`, () => {
		const fixture = platformSchemaFixture();
		try {
			if (changed) {
				const document = structuredClone(fixture.document);
				document.$defs.AssignmentAttempt = true;
				fixture.commit(document);
			}
			const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
				fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url)), 'platform', 'verify', '--json'], {
				cwd: fixture.root, encoding: 'utf8', timeout: 15_000,
				env: { ...process.env, XDG_CONFIG_HOME: resolve(fixture.root, 'config'), XDG_STATE_HOME: resolve(fixture.root, 'state') },
			});
			assert.equal(result.error, undefined);
			const envelope = JSON.parse((result.stdout || result.stderr).trim()) as Envelope;
			assert.equal(result.status, changed ? 1 : 0);
			assert.equal(envelope.ok, !changed);
			if (changed) assert.equal(envelope.error?.code, 'platform_verification_failed');
		} finally { fixture.close(); }
	});
}
