import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class RegistryPropagationError extends Error {}

export type PublishedPackageReadbackInput = {
	packageName: string;
	packageVersion: string;
	packageDigest: string;
	distTag: 'latest' | 'rc';
	expectedLatest: string;
	destination: string;
	cwd: string;
	deadlineMs?: number;
	perCallTimeoutMs?: number;
	execNpm?: (args: string[], timeout: number) => string;
	readArtifact?: (path: string) => Buffer;
	now?: () => number;
	delay?: (milliseconds: number) => Promise<void>;
};

const retryableRegistryFailure = (error: unknown): boolean => {
	if (error instanceof RegistryPropagationError) return true;
	const detail = error as { stdout?: unknown; stderr?: unknown };
	const output = `${String(detail.stdout ?? '')}\n${String(detail.stderr ?? '')}\n${error instanceof Error ? error.message : String(error)}`;
	return ['E404', 'ETARGET', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'E502', 'E503', 'E504', 'FETCH_ERROR']
		.some((marker) => output.includes(marker));
};

export async function readBackPublishedPackage(input: PublishedPackageReadbackInput) {
	const now = input.now ?? Date.now;
	const delay = input.delay ?? ((milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
	const deadline = now() + (input.deadlineMs ?? 180_000);
	const perCallTimeout = input.perCallTimeoutMs ?? 15_000;
	const execNpm = input.execNpm ?? ((args, timeout) => execFileSync('npm', args, {
		cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
	}));
	const readArtifact = input.readArtifact ?? readFileSync;
	const remainingTimeout = () => Math.max(1, Math.min(perCallTimeout, deadline - now()));
	const waitForPropagation = async (error: unknown) => {
		if (!retryableRegistryFailure(error) || now() >= deadline) throw error;
		await delay(Math.min(3000, Math.max(1, deadline - now())));
	};

	let observedDigest = '';
	while (!observedDigest) {
		try {
			const packed = JSON.parse(execNpm([
				'pack', `${input.packageName}@${input.packageVersion}`, '--json', '--ignore-scripts', '--prefer-online',
				'--pack-destination', input.destination,
			], remainingTimeout())) as Array<{ filename: string }>;
			observedDigest = createHash('sha256').update(readArtifact(resolve(input.destination, packed[0]!.filename))).digest('hex');
		} catch (error) {
			await waitForPropagation(error);
		}
	}
	if (observedDigest !== input.packageDigest) {
		throw new Error(`Published CLI digest ${observedDigest} does not match ${input.packageDigest}.`);
	}

	let tags: Record<string, string> = {};
	while (tags[input.distTag] !== input.packageVersion) {
		try {
			tags = JSON.parse(execNpm(['view', input.packageName, 'dist-tags', '--json', '--prefer-online'], remainingTimeout())) as Record<string, string>;
			if (tags.latest !== input.expectedLatest) throw new Error(`npm latest changed from ${input.expectedLatest} to ${tags.latest ?? 'nothing'}.`);
			if (tags[input.distTag] !== input.packageVersion) {
				throw new RegistryPropagationError(`npm ${input.distTag} points to ${tags[input.distTag] ?? 'nothing'}, expected ${input.packageVersion}.`);
			}
		} catch (error) {
			await waitForPropagation(error);
		}
	}
	return { packageVersion: input.packageVersion, packageDigest: observedDigest, distTag: input.distTag, latest: tags.latest! };
}
