import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { packageRoot } from './paths.ts';

const legacyDocsRoot = path.resolve(packageRoot, '../..');
const candidateStarlightRoots = [
	path.join(process.cwd(), 'node_modules/@astrojs/starlight'),
	path.join(packageRoot, 'node_modules/@astrojs/starlight'),
	path.join(legacyDocsRoot, 'node_modules/@astrojs/starlight'),
];
const candidateCollectionFiles = [
	path.join(process.cwd(), 'node_modules/@astrojs/starlight/utils/collection.ts'),
	path.join(packageRoot, 'node_modules/@astrojs/starlight/utils/collection.ts'),
	path.join(legacyDocsRoot, 'node_modules/@astrojs/starlight/utils/collection.ts'),
];

const originalSource = `export type StarlightCollection = 'docs' | 'i18n';

/**
 * We still rely on the content collection folder structure to be fixed for now:
 *
 * - At build time, if the feature is enabled, we get all the last commit dates for each file in
 *   the docs folder ahead of time. In the current approach, we cannot know at this time the
 *   user-defined content folder path in the integration context as this would only be available
 *   from the loader. A potential solution could be to do that from a custom loader re-implementing
 *   the glob loader or built on top of it. Although, we don't have access to the Starlight
 *   configuration from the loader to even know we should do that.
 * - Remark plugins get passed down an absolute path to a content file and we need to figure out
 *   the language from that path. Without knowing the content folder path, we cannot reliably do
 *   so.
 *
 * Below are various functions to easily get paths to these collections and avoid having to
 * hardcode them throughout the codebase. When user-defined content folder locations are supported,
 * these helper functions should be updated to reflect that in one place.
 */

export function getCollectionUrl(collection: StarlightCollection, srcDir: URL) {
\treturn new URL(\`content/\${collection}/\`, srcDir);
}

export function getCollectionPathFromRoot(
\tcollection: StarlightCollection,
\t{ root, srcDir }: { root: URL | string; srcDir: URL | string }
) {
\treturn (
\t\t(typeof srcDir === 'string' ? srcDir : srcDir.pathname).replace(
\t\t\ttypeof root === 'string' ? root : root.pathname,
\t\t\t''
\t\t) +
\t\t'content/' +
\t\tcollection
\t);
}
`;

const patchedSource = `export type StarlightCollection = 'docs' | 'i18n';

/**
 * We still rely on the content collection folder structure to be fixed for now:
 *
 * - At build time, if the feature is enabled, we get all the last commit dates for each file in
 *   the docs folder ahead of time. In the current approach, we cannot know at this time the
 *   user-defined content folder path in the integration context as this would only be available
 *   from the loader. A potential solution could be to do that from a custom loader re-implementing
 *   the glob loader or built on top of it. Although, we don't have access to the Starlight
 *   configuration from the loader to even know we should do that.
 * - Remark plugins get passed down an absolute path to a content file and we need to figure out
 *   the language from that path. Without knowing the content folder path, we cannot reliably do
 *   so.
 *
 * Below are various functions to easily get paths to these collections and avoid having to
 * hardcode them throughout the codebase. When user-defined content folder locations are supported,
 * these helper functions should be updated to reflect that in one place.
 */

export function getCollectionUrl(collection: StarlightCollection, srcDir: URL) {
\treturn new URL(\`content/\${getCollectionDir(collection)}/\`, srcDir);
}

function getCollectionDir(collection: StarlightCollection) {
\treturn collection === 'docs' ? 'knowledge' : collection;
}

export function getCollectionPathFromRoot(
\tcollection: StarlightCollection,
\t{ root, srcDir }: { root: URL | string; srcDir: URL | string }
) {
\treturn (
\t\t(typeof srcDir === 'string' ? srcDir : srcDir.pathname).replace(
\t\t\ttypeof root === 'string' ? root : root.pathname,
\t\t\t''
\t\t) +
\t\t'content/' +
\t\tgetCollectionDir(collection)
\t);
}
`;

async function patchCollectionFile(collectionFile) {
	const source = await fs.readFile(collectionFile, 'utf8');

	if (source === patchedSource) {
		return 'already';
	}

	if (source !== originalSource) {
		throw new Error(`Unexpected Starlight collection helper format in ${collectionFile}`);
	}

	await fs.writeFile(collectionFile, patchedSource);
	return 'patched';
}

async function copyVendoredTree(sourceRoot, targetRoot) {
	const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
	for (const entry of entries) {
		const sourcePath = path.join(sourceRoot, entry.name);
		const targetPath = path.join(targetRoot, entry.name);
		if (entry.isDirectory()) {
			await fs.mkdir(targetPath, { recursive: true });
			await copyVendoredTree(sourcePath, targetPath);
			continue;
		}

		await fs.copyFile(sourcePath, targetPath);
	}
}

async function patchStarlightPackageRoot(starlightRoot) {
	const packageJsonPath = path.join(starlightRoot, 'package.json');
	const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
	const coreVendorRoot = path.join(path.dirname(path.dirname(starlightRoot)), '@treeseed/core/dist/vendor/starlight');
	await copyVendoredTree(coreVendorRoot, starlightRoot);

	packageJson.exports = {
		...packageJson.exports,
		'.': './index.js',
		'./schema': './schema.js',
		'./loaders': './loaders.js',
		'./route-data': './route-data.js',
		'./internal': './internal.js',
		'./components': './components.js',
	};

	await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

async function run() {
	const existingFiles = [];
	for (const collectionFile of candidateCollectionFiles) {
		try {
			await fs.access(collectionFile);
			existingFiles.push(collectionFile);
		} catch {
			// Ignore missing dependency trees.
		}
	}

	if (existingFiles.length === 0) {
		throw new Error('Unable to find any Starlight collection helper files to patch.');
	}

	let patchedAny = false;
	for (const collectionFile of existingFiles) {
		const result = await patchCollectionFile(collectionFile);
		patchedAny = patchedAny || result === 'patched';
	}

	for (const starlightRoot of candidateStarlightRoots) {
		try {
			await fs.access(path.join(starlightRoot, 'package.json'));
			await patchStarlightPackageRoot(starlightRoot);
			patchedAny = true;
		} catch {
			// Ignore missing dependency trees.
		}
	}

	console.log(
		patchedAny
			? 'Applied Starlight knowledge-path patch.'
			: 'Starlight knowledge-path patch already applied.',
	);
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
