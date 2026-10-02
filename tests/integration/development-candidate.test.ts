import assert from 'node:assert/strict';
import { chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { candidateFixture } from '../support/development-candidate.ts';

for (const kind of ['bytes', 'mode', 'link', 'deleted', 'added', 'during verification'] as const) {
	test(`native candidate verification rejects untracked ${kind} changes without registering a pass`, async () => {
		const fixture = candidateFixture();
		try {
			const source = resolve(fixture.root, 'local-source.ts');
			if (kind === 'link') symlinkSync('treeseed.package.yaml', source);
			else { writeFileSync(source, 'export const a = 1;'); chmodSync(source, 0o644); }
			if (kind === 'during verification') writeFileSync(resolve(fixture.root, 'scripts/verify.ts'), "import { appendFileSync, writeFileSync } from 'node:fs'; appendFileSync('verification.log', 'verified\\n'); writeFileSync('local-source.ts', 'export const a = 2;');\n");
			const frozen = await fixture.freeze(), receipt = readFileSync(frozen.receipt, 'utf8');
			if (kind === 'bytes') writeFileSync(source, 'export const a = 2;');
			else if (kind === 'mode') chmodSync(source, 0o755);
			else if (kind === 'link') { rmSync(source); symlinkSync('.gitignore', source); }
			else if (kind === 'deleted') rmSync(source);
			else if (kind === 'added') writeFileSync(resolve(fixture.root, 'additional.ts'), '');
			assert.equal(await fixture.verify(), 1, `Changed ${kind} was incorrectly verified`);
			assert.match(fixture.output.join(''), /Candidate source changed after freeze/);
			assert.equal(fixture.registrations.length, 1);
			assert.equal(readFileSync(frozen.receipt, 'utf8'), receipt);
			assert.equal(readFileSync(resolve(fixture.root, 'verification.log'), 'utf8'), 'verified\n');
		} finally { fixture.close(); }
	});
}

test('native dirty candidate verification excludes generated artifact and remains non-promotable', async () => {
	const fixture = candidateFixture();
	try {
		writeFileSync(resolve(fixture.root, 'local-source.ts'), 'export {};');
		const frozen = await fixture.freeze();
		assert.equal(await fixture.verify(), 0, fixture.output.join(''));
		assert.equal(fixture.readReceipt(frozen.receipt).verification.status, 'passed');
		assert.equal(fixture.readReceipt(frozen.receipt).promotable, false);
		assert.equal(fixture.registrations.length, 2);
		assert.equal(await fixture.verify(), 0, fixture.output.join(''));
		writeFileSync(resolve(fixture.root, 'candidate.bin'), 'tampered');
		assert.equal(await fixture.verify(), 1);
		assert.match(fixture.output.join(''), /artifact custody failed/);
		assert.equal(fixture.registrations.length, 3);
	} finally { fixture.close(); }
});
