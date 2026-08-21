import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseCliReleaseVersion } from './release-version.ts';
import { readBackPublishedPackage } from './published-package-readback.ts';

const root = resolve(import.meta.dirname, '../..');
const packageDocument = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name: string; version: string };
const tagName = process.env.GITHUB_REF_NAME ?? '';
const release = parseCliReleaseVersion(tagName, packageDocument.version);
const packageDigest = process.env.EXPECTED_SHA256?.trim();
const previousLatest = process.env.EXPECTED_LATEST?.trim();
if (!packageDigest || !previousLatest) throw new Error('Published read-back requires EXPECTED_SHA256 and EXPECTED_LATEST.');
const destination = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-published-'));
try {
	const result = await readBackPublishedPackage({
		packageName: packageDocument.name,
		packageVersion: packageDocument.version,
		packageDigest,
		distTag: release.distTag,
		expectedLatest: release.distTag === 'rc' ? previousLatest : packageDocument.version,
		destination,
		cwd: root,
	});
	console.log(JSON.stringify({ ok: true, ...result }));
} finally {
	rmSync(destination, { recursive: true, force: true });
}
