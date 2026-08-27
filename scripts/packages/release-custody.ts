import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { releaseEvidenceSchema } from '@treeseed/sdk/development';

const root = resolve(import.meta.dirname, '../..');
const sha256 = (path: string) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}` as const;
const command = process.argv[2], evidencePath = resolve(root, process.argv[3] ?? 'artifacts/release-evidence-v1.json');

if (command === 'seal') {
	const artifactPath = resolve(root, process.argv[4]!), sbomPath = resolve(root, 'artifacts/sbom.cdx.json');
	const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name: string; version: string };
	const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	const artifactDigest = sha256(artifactPath), sbomDigest = sha256(sbomPath);
	const receiptDigest = `sha256:${createHash('sha256').update(`${sourceCommit}\n${artifactDigest}\n${sbomDigest}`).digest('hex')}` as const;
	const evidence = releaseEvidenceSchema.parse({
		schemaVersion: 'treeseed.release-evidence/v1',
		candidate: { id: `candidate-${sourceCommit.slice(0, 12)}`, receiptDigest, sourceCommit, stagingRef: process.env.GITHUB_REF ?? 'refs/heads/staging', workflowRunId: process.env.GITHUB_RUN_ID ?? '1', createdAt: new Date().toISOString() },
		packages: [{ projectId: 'cli', name: packageJson.name, version: packageJson.version, minimumBump: 'patch' }],
		artifacts: [
			{ id: 'cli-package', kind: 'npm-package', identity: basename(artifactPath), digest: artifactDigest, mediaType: 'application/gzip', size: statSync(artifactPath).size },
			{ id: 'cli-sbom', kind: 'sbom', identity: basename(sbomPath), digest: sbomDigest, mediaType: 'application/vnd.cyclonedx+json', size: statSync(sbomPath).size },
		],
		contractBundles: [], compatibilityAttestations: [],
		verification: { status: 'passed', operations: ['npm run verify:direct'], completedAt: new Date().toISOString() },
	});
	writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(JSON.stringify({ ok: true, evidencePath, artifactDigest }));
} else if (command === 'verify') {
	const evidence = releaseEvidenceSchema.parse(JSON.parse(readFileSync(evidencePath, 'utf8')));
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	if (evidence.candidate.sourceCommit !== commit) throw new Error('Candidate custody source commit differs from the tagged commit.');
	if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF_NAME !== evidence.packages[0]?.version) throw new Error('Tag does not match sealed package version.');
	for (const artifact of evidence.artifacts) {
		const path = resolve(evidencePath, '..', artifact.identity);
		if (sha256(path) !== artifact.digest) throw new Error(`Candidate artifact digest mismatch: ${artifact.identity}.`);
	}
	console.log(JSON.stringify({ ok: true, candidateId: evidence.candidate.id, artifacts: evidence.artifacts.length }));
} else throw new Error('release-custody requires seal or verify.');
