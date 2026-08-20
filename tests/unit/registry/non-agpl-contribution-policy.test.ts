import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('CLI does not impose the AGPL commercial-license approval process', () => {
	const root = process.cwd();
	const template = readFileSync(resolve(root, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');
	const guidance = readFileSync(resolve(root, 'CONTRIBUTING.md'), 'utf8');
	assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).license, 'Apache-2.0');
	assert.equal(existsSync(resolve(root, '.github/workflows/contributor-license.yml')), false);
	assert.equal(existsSync(resolve(root, '.github/approved-committers.json')), false);
	assert.doesNotMatch(template, /Contribution grant|contribution-attestation/u);
	assert.match(guidance, /does not require a separate contributor-grant checkbox/u);
});
