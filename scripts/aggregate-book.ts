import fs from 'node:fs';
import path from 'node:path';
import { buildTenantBookRuntime } from '@treeseed/core/utils/books-data';
import { loadTreeseedManifest } from '@treeseed/core/tenant-config';

const PROJECT_TENANT = loadTreeseedManifest();
const { BOOKS, TREESEED_LIBRARY_DOWNLOAD } = buildTenantBookRuntime(PROJECT_TENANT, {
	projectRoot: PROJECT_TENANT.__tenantRoot ?? process.cwd(),
	docsLibraryDownload: {
		downloadFileName: 'karyon-knowledge.md',
		downloadHref: '/books/karyon-knowledge.md',
		downloadTitle: 'Karyon Knowledge Library',
	},
});
const projectRoot = PROJECT_TENANT.__tenantRoot ?? process.cwd();
const outputDir = path.join(projectRoot, 'public', 'books');
const legacyOutputFile = path.join(projectRoot, 'public', 'book.md');

function sortPaths(paths) {
	return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

function getSidebarOrder(filePath) {
	const rawContent = fs.readFileSync(filePath, 'utf8');
	const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatterMatch) return Number.POSITIVE_INFINITY;

	const orderMatch = frontmatterMatch[1].match(/^\s{2}order:\s*(\d+)\s*$/m);
	return orderMatch ? Number.parseInt(orderMatch[1], 10) : Number.POSITIVE_INFINITY;
}

function collectMarkdownFiles(rootPath) {
	if (!fs.existsSync(rootPath)) {
		throw new Error(`Book export root not found: ${rootPath}`);
	}

	const stats = fs.statSync(rootPath);
	if (stats.isFile()) {
		return [rootPath];
	}

	const entries = fs.readdirSync(rootPath, { withFileTypes: true });
	return sortPaths(
		entries.flatMap((entry) => {
			const fullPath = path.join(rootPath, entry.name);
			if (entry.isDirectory()) {
				return collectMarkdownFiles(fullPath);
			}

			if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
				return [fullPath];
			}

			return [];
		}),
	);
}

function stripFrontmatter(content) {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function stripMdxOnlySyntax(content) {
	return content
		.replace(/^import\s.+$/gm, '')
		.replace(/^\s*<\/?[A-Z][^>]*>\s*$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function inferExportRootFromBasePath(book) {
	const normalizedBasePath = String(book.basePath || '').trim();
	const knowledgePrefix = '/knowledge/';
	if (!normalizedBasePath.startsWith(knowledgePrefix)) {
		throw new Error(`Book basePath must start with "${knowledgePrefix}" to infer exports: ${book.basePath}`);
	}

	const relativeKnowledgePath = normalizedBasePath
		.slice(knowledgePrefix.length)
		.replace(/^\/+|\/+$/g, '');
	if (!relativeKnowledgePath) {
		throw new Error(`Book basePath must identify a knowledge directory: ${book.basePath}`);
	}

	return path.join(PROJECT_TENANT.content.docs, relativeKnowledgePath);
}

function resolveExportRoots(book) {
	if (Array.isArray(book.exportRoots) && book.exportRoots.length > 0) {
		return book.exportRoots;
	}

	return [inferExportRootFromBasePath(book)];
}

function resolveBookFiles(book) {
	const files = resolveExportRoots(book).flatMap((root) =>
		collectMarkdownFiles(path.resolve(projectRoot, root)).sort((left, right) => {
			const orderDelta = getSidebarOrder(left) - getSidebarOrder(right);
			if (orderDelta !== 0) return orderDelta;

			return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
		}),
	);

	return Array.from(new Set(files));
}

function buildBookMarkdown(book) {
	const sections = resolveBookFiles(book).map((filePath) => {
		const rawContent = fs.readFileSync(filePath, 'utf8');
		return stripMdxOnlySyntax(stripFrontmatter(rawContent));
	});

	return `# ${book.downloadTitle}\n\n> This document is auto-generated from the Karyon knowledge source.\n\n${sections.join('\n\n---\n\n')}\n`;
}

function ensureOutputDir() {
	fs.mkdirSync(outputDir, { recursive: true });
}

function writeBookOutput(fileName, content) {
	const outputPath = path.join(outputDir, fileName);
	fs.writeFileSync(outputPath, content);
	return outputPath;
}

function main() {
	console.log('Generating contextual Karyon knowledge exports...');
	ensureOutputDir();

	const bookOutputs = BOOKS.map((book) => {
		const content = buildBookMarkdown(book);
		const outputPath = writeBookOutput(book.downloadFileName, content);
		console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
		return { book, content };
	});

	const compositeContent = `# ${TREESEED_LIBRARY_DOWNLOAD.downloadTitle}\n\n> This document is auto-generated from the Karyon knowledge source.\n\n${bookOutputs
		.map(({ content }) => content.trim())
		.join('\n\n---\n\n')}\n`;

	const compositeOutputPath = writeBookOutput(TREESEED_LIBRARY_DOWNLOAD.downloadFileName, compositeContent);
	console.log(`Generated ${path.relative(projectRoot, compositeOutputPath)}`);

	if (fs.existsSync(legacyOutputFile)) {
		fs.rmSync(legacyOutputFile);
		console.log(`Removed legacy export ${path.relative(projectRoot, legacyOutputFile)}`);
	}
}

main();
