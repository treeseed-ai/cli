import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

function files(root: string): string[] {
	if (!existsSync(root)) return [];
	const stat = lstatSync(root); if (!stat.isDirectory()) return [root];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => files(resolve(root, entry.name)));
}

function signature(root: string, outputs: string[], marker: string) {
	const markerPath = resolve(root, marker); if (!existsSync(markerPath)) return '';
	const hash = createHash('sha256');
	hash.update(readFileSync(markerPath));
	for (const output of outputs) for (const path of files(resolve(root, output)).sort()) {
		const stat = statSync(path); hash.update(relative(root, path)); hash.update(String(stat.size)); hash.update(String(stat.mtimeMs));
	}
	return hash.digest('hex');
}

function publish(root: string, overlayRoot: string, outputs: string[], generation: number) {
	const target = resolve(overlayRoot, `generation-${generation}`), next = resolve(overlayRoot, '.current-next'), current = resolve(overlayRoot, 'current');
	rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true, mode: 0o700 });
	cpSync(resolve(root, 'package.json'), resolve(target, 'package.json'));
	if (existsSync(resolve(root, 'node_modules'))) symlinkSync(resolve(root, 'node_modules'), resolve(target, 'node_modules'), 'dir');
	for (const output of outputs) {
		const source = resolve(root, output); if (!existsSync(source)) throw new Error(`Package overlay output is unavailable: ${output}.`);
		const destination = resolve(target, output); mkdirSync(dirname(destination), { recursive: true }); cpSync(source, destination, { recursive: true });
	}
	rmSync(next, { force: true }); symlinkSync(target, next, 'dir'); renameSync(next, current);
	for (const entry of readdirSync(overlayRoot)) if (entry.startsWith('generation-') && entry !== `generation-${generation}` && entry !== `generation-${generation - 1}`) rmSync(resolve(overlayRoot, entry), { recursive: true, force: true });
}

export async function synchronizePackageOverlay(root: string, overlayRoot: string, outputs: string[], marker: string, intervalMs = 250) {
	mkdirSync(overlayRoot, { recursive: true, mode: 0o700 });
	let observed = '', stable = '', published = '', generation = 0;
	while (true) {
		try {
			observed = signature(root, outputs, marker);
			if (observed && observed === stable && observed !== published) { generation += 1; publish(root, overlayRoot, outputs, generation); published = observed; }
			stable = observed;
		} catch { /* keep the prior completed generation while a build is incomplete */ }
		await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
	}
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
	const [root, overlayRoot, encodedOutputs, marker] = process.argv.slice(2);
	if (!root || !overlayRoot || !encodedOutputs || !marker) throw new Error('Package overlay synchronizer requires root, overlay root, outputs, and a completion marker.');
	await synchronizePackageOverlay(root, overlayRoot, JSON.parse(encodedOutputs) as string[], marker);
}
