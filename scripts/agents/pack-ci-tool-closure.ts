import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packagePaths = [
	'node_modules/@treeseed/sdk',
	'node_modules/@treeseed/ui',
	'node_modules/@treeseed/core',
	'node_modules/@treeseed/agent',
	'.',
];
const outputRoot = resolve(process.argv[2] ?? 'artifacts');
const stagingRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-cli-tool-closure-'));

function packageJson(path: string) {
	return JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8')) as Record<string, unknown>;
}

const versions = new Map<string, string>();
for (const packagePath of packagePaths) {
	const manifest = packageJson(resolve(packagePath));
	versions.set(String(manifest.name), String(manifest.version));
}

try {
	mkdirSync(outputRoot, { recursive: true });
	for (const [index, packagePath] of packagePaths.entries()) {
		const source = resolve(packagePath);
		const destination = resolve(stagingRoot, `${index}-${basename(source)}`);
		cpSync(source, destination, {
			recursive: true,
			filter: (entry) => {
				const relative = entry.slice(source.length).replace(/^\//, '');
				return relative !== 'node_modules'
					&& !relative.startsWith('node_modules/')
					&& relative !== '.git'
					&& !relative.startsWith('.git/')
					&& relative !== 'artifacts'
					&& !relative.startsWith('artifacts/');
			},
		});
		const manifestPath = resolve(destination, 'package.json');
		const manifest = packageJson(destination);
		for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
			const dependencies = manifest[field];
			if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
			for (const [name, version] of versions) {
				if (name in dependencies) {
					(dependencies as Record<string, string>)[name] = version;
				}
			}
		}
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
		const packed = spawnSync('npm', ['pack', destination, '--json', '--ignore-scripts', '--pack-destination', outputRoot], {
			stdio: 'inherit',
		});
		if (packed.status !== 0) {
			throw new Error(`Failed to pack ${String(manifest.name)}.`);
		}
	}
} finally {
	rmSync(stagingRoot, { recursive: true, force: true });
}
