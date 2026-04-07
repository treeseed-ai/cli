import { spawnSync } from 'node:child_process';

const EXPECTED_PORTS = ['1025->1025/tcp', '8025->8025/tcp'];
const KNOWN_MAILPIT_NAMES = ['treeseed_mailpit', 'karyon_docs_mailpit'];

function runDocker(args, options = {}) {
	return spawnSync('docker', args, {
		encoding: 'utf8',
		...options,
	});
}

function parseDockerPsOutput(stdout) {
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [name = '', image = '', ports = ''] = line.split('\t');
			return { name, image, ports };
		});
}

function isCompatibleMailpitContainer(container) {
	const nameMatch = KNOWN_MAILPIT_NAMES.includes(container.name);
	const imageMatch = container.image.includes('mailpit');
	const portsMatch = EXPECTED_PORTS.every((port) => container.ports.includes(port));
	return (nameMatch || imageMatch) && portsMatch;
}

export function dockerIsAvailable() {
	const result = runDocker(['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}']);
	return result.status === 0;
}

export function findRunningMailpitContainer() {
	const result = runDocker(['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}']);
	if (result.status !== 0) {
		return null;
	}

	return parseDockerPsOutput(result.stdout).find(isCompatibleMailpitContainer) ?? null;
}

export function stopKnownMailpitContainers() {
	const container = findRunningMailpitContainer();
	if (!container) {
		return true;
	}

	const stopResult = runDocker(['stop', container.name], { stdio: 'inherit' });
	if (stopResult.status !== 0) {
		return false;
	}

	const removeResult = runDocker(['rm', '-f', container.name], { stdio: 'inherit' });
	return removeResult.status === 0;
}

export function streamKnownMailpitLogs() {
	const container = findRunningMailpitContainer();
	if (!container) {
		console.error('No running Mailpit container was found on ports 1025 and 8025.');
		process.exit(1);
	}

	const result = runDocker(['logs', '-f', container.name], { stdio: 'inherit' });
	process.exit(result.status ?? 1);
}
