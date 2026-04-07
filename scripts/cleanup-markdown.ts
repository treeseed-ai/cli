import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_TARGETS = ['src/content/knowledge', 'src/content/pages', 'src/content/notes'];
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

export async function normalizeMarkdown(source, options = {}) {
	const normalizedSource = source.replace(/\r\n?/g, '\n');
	const { frontmatter, body } = splitFrontmatter(normalizedSource);
	const preprocessed = preprocessMarkdownBody(body);
	const isMdxFile = (options.filePath ?? '').toLowerCase().endsWith('.mdx');

	const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).use(remarkMath);

	if (isMdxFile) {
		processor.use(remarkMdx);
	}

	processor.use(remarkStringify, {
		bullet: '-',
		closeAtx: false,
		fences: true,
		incrementListMarker: true,
		listItemIndent: 'one',
		resourceLink: true,
		rule: '*',
		ruleRepetition: 3,
		ruleSpaces: false,
		setext: false,
		tightDefinitions: true,
	});

	const rendered = postprocessMarkdown(
		String(await processor.process({ path: options.filePath ?? 'document.md', value: preprocessed })),
	).trimEnd();
	const segments = [];

	if (frontmatter) {
		segments.push(frontmatter.trimEnd());
	}

	if (rendered) {
		segments.push(rendered);
	}

	return `${segments.join('\n\n')}\n`;
}

export async function collectMarkdownTargets(inputPaths, cwd = process.cwd()) {
	const requested = inputPaths.length > 0 ? inputPaths : DEFAULT_TARGETS;
	const resolved = requested.map((target) => resolveTargetPath(target, cwd));
	const files = [];

	for (const target of resolved) {
		const stats = await safeStat(target);
		if (!stats) {
			continue;
		}

		if (stats.isFile()) {
			if (isMarkdownFile(target)) {
				files.push(target);
			}
			continue;
		}

		files.push(...(await collectMarkdownFiles(target)));
	}

	return [...new Set(files)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

async function collectMarkdownFiles(rootPath) {
	const entries = await fs.readdir(rootPath, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectMarkdownFiles(fullPath)));
			continue;
		}

		if (entry.isFile() && isMarkdownFile(fullPath)) {
			files.push(fullPath);
		}
	}

	return files;
}

function isMarkdownFile(filePath) {
	return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function safeStat(targetPath) {
	try {
		return await fs.stat(targetPath);
	} catch {
		return null;
	}
}

function resolveTargetPath(target, cwd) {
	const directPath = path.resolve(cwd, target);
	if (path.isAbsolute(target)) {
		return target;
	}

	if (fsSyncExists(directPath)) {
		return directPath;
	}

	if (path.basename(cwd) === 'docs' && target.startsWith('docs/')) {
		return path.resolve(cwd, target.slice('docs/'.length));
	}

	return directPath;
}

function fsSyncExists(targetPath) {
	try {
		return fsSync.existsSync(targetPath);
	} catch {
		return false;
	}
}

function splitFrontmatter(source) {
	if (!source.startsWith('---\n')) {
		return { frontmatter: '', body: source };
	}

	const closingIndex = source.indexOf('\n---\n', 4);
	if (closingIndex === -1) {
		return { frontmatter: '', body: source };
	}

	const frontmatter = source.slice(0, closingIndex + 5);
	const body = source.slice(closingIndex + 5);
	return { frontmatter, body };
}

function preprocessMarkdownBody(body) {
	const lines = body.split('\n');
	const output = [];
	let inFence = false;
	let fenceMarker = '';
	let fenceLength = 0;
	let previousNonBlankType = 'start';

	for (const originalLine of lines) {
		const line = originalLine.trimEnd();
		const trimmed = line.trim();

		if (inFence) {
			pushLine(output, line);
			if (isFenceClose(line, fenceMarker, fenceLength)) {
				inFence = false;
				previousNonBlankType = 'fence';
			}
			continue;
		}

		if (trimmed === '') {
			pushBlankLine(output);
			continue;
		}

		if (isFenceOpen(line)) {
			if (needsBlankLineBefore(previousNonBlankType)) {
				pushBlankLine(output);
			}
			pushLine(output, line);
			({ marker: fenceMarker, length: fenceLength } = getFenceInfo(line));
			inFence = true;
			previousNonBlankType = 'fence';
			continue;
		}

		const lineType = classifyLine(line);

		const previousLine = output.length > 0 ? findPreviousNonBlankLine(output) : '';
		if (requiresBlankLineBetween(previousNonBlankType, lineType, previousLine, line)) {
			pushBlankLine(output);
		}

		pushLine(output, line);
		previousNonBlankType = lineType;
	}

	return collapseBlankLines(output).join('\n').trim();
}

function classifyLine(line) {
	if (isTableLine(line)) return 'table';
	if (/^\s{0,3}#{1,6}\s+\S/.test(line)) return 'heading';
	if (/^\s{0,3}(?:[-*_])(?:\s*\1){2,}\s*$/.test(line)) return 'rule';
	if (/^\s{0,3}>\s?/.test(line)) return 'blockquote';
	if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) return 'list';
	if (/^\s*<(?:[A-Za-z][^>]*)>\s*$/.test(line)) return 'html';
	if (/^\s*(?:import|export)\s.+$/.test(line)) return 'mdx';
	if (/^\s*<\/?[A-Z][^>]*>\s*$/.test(line)) return 'mdx';
	return 'prose';
}

function isTableLine(line) {
	const trimmed = line.trim();
	return /^\|.*\|\s*$/.test(trimmed) || /^[:\-|\s]+$/.test(trimmed);
}

function isFenceOpen(line) {
	return /^\s{0,3}(```+|~~~+)/.test(line);
}

function getFenceInfo(line) {
	const match = line.match(/^\s{0,3}(```+|~~~+)/);
	return {
		length: match?.[1]?.length ?? 3,
		marker: match?.[1]?.[0] ?? '`',
	};
}

function isFenceClose(line, marker, requiredLength) {
	return new RegExp(`^\\s{0,3}${escapeRegExp(marker)}{${requiredLength},}\\s*$`).test(line);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function needsBlankLineBefore(previousType) {
	return !['start', 'blank'].includes(previousType);
}

function requiresBlankLineBetween(previousType, currentType, previousLine, currentLine) {
	if (previousType === 'start') return false;
	if (previousType === 'table' && currentType === 'table') return false;
	if (previousType === 'blockquote' && currentType === 'blockquote') return false;
	if (previousType === 'mdx' && currentType === 'mdx') return false;
	if (previousType === 'html' && currentType === 'prose' && /^\s*<a\b/i.test(currentLine)) return false;
	if (previousType === 'prose' && currentType === 'prose' && looksLikeParagraphBoundary(previousLine, currentLine)) return true;
	if (currentType === 'heading' || currentType === 'rule' || currentType === 'blockquote') return true;
	if (previousType === 'heading') return true;
	if (previousType === 'rule') return true;
	if (previousType === 'table' && currentType !== 'table') return true;
	if (previousType === 'list' && currentType === 'prose') return true;
	if (previousType === 'list' && ['heading', 'rule', 'table', 'html', 'mdx'].includes(currentType)) return true;
	if (previousType === 'prose' && ['list', 'table', 'html', 'mdx'].includes(currentType)) return true;
	if (['html', 'mdx'].includes(previousType) && currentType === 'prose') return true;
	return false;
}

function findPreviousNonBlankLine(lines) {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index].trim() !== '') {
			return lines[index];
		}
	}

	return '';
}

function pushLine(output, line) {
	output.push(line);
}

function pushBlankLine(output) {
	if (output.length === 0) return;
	if (output.at(-1) === '') return;
	output.push('');
}

function collapseBlankLines(lines) {
	const collapsed = [];

	for (const line of lines) {
		if (line === '' && collapsed.at(-1) === '') {
			continue;
		}
		collapsed.push(line);
	}

	return collapsed;
}

function postprocessMarkdown(content) {
	return content
		.replace(/\[\\\[(\d+)\\\]\]\(#ref-\1\)/g, '[[$1]](#ref-$1)')
		.replace(/<a([^>]*?)\s*\/>/g, '<a$1></a>');
}

function looksLikeParagraphBoundary(previousLine, currentLine) {
	const previous = previousLine.trim();
	const current = currentLine.trim();

	if (!previous || !current) {
		return false;
	}

	if (/^\*\*\d+\./.test(current) || /^\*[^*]+:\*/.test(current)) {
		return true;
	}

	if (/^\*\*.*\*\*$/.test(previous) && /^\*[^*]+:\*/.test(current)) {
		return true;
	}

	return endsLikeStandaloneParagraph(previous) && startsLikeStandaloneParagraph(current);
}

function endsLikeStandaloneParagraph(line) {
	return /(?:[.!?]["')\]]*|\*{1,2}|\d)\s*$/.test(line);
}

function startsLikeStandaloneParagraph(line) {
	return /^(?:[A-Z0-9]|\*\*|\*[^*]+:\*|\[|["'(])/.test(line);
}

function parseArgs(argv) {
	const args = { check: false, write: false, targets: [] };

	for (const arg of argv) {
		if (arg === '--check') {
			args.check = true;
			continue;
		}
		if (arg === '--write') {
			args.write = true;
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			args.help = true;
			continue;
		}
		args.targets.push(arg);
	}

	if (!args.check && !args.write) {
		args.write = true;
	}

	return args;
}

function printHelp() {
	console.log(`Usage: node scripts/cleanup-markdown.mjs [--check|--write] [paths...]

Normalizes Markdown/MDX files for public docs readability.

Examples:
  npm run cleanup:markdown --workspace docs -- src/content/knowledge/research
  npm run cleanup:markdown:check --workspace docs -- src/content/pages/status.mdx
`);
}

async function runCli(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help) {
		printHelp();
		return 0;
	}

	if (args.check && args.write) {
		console.error('Choose either --check or --write, not both.');
		return 1;
	}

	const mode = args.check ? 'check' : 'write';
	const targets = await collectMarkdownTargets(args.targets);
	if (targets.length === 0) {
		console.error('No Markdown files found for cleanup.');
		return 1;
	}

	const changedFiles = [];

	for (const filePath of targets) {
		const original = await fs.readFile(filePath, 'utf8');
		const normalized = await normalizeMarkdown(original, { filePath });
		if (normalized === original) {
			continue;
		}

		changedFiles.push(filePath);
		if (mode === 'write') {
			await fs.writeFile(filePath, normalized, 'utf8');
		}
	}

	if (mode === 'check') {
		if (changedFiles.length > 0) {
			console.error('Markdown cleanup needed in:');
			for (const filePath of changedFiles) {
				console.error(`- ${path.relative(process.cwd(), filePath)}`);
			}
			return 1;
		}

		console.log(`Markdown cleanup check passed for ${targets.length} file(s).`);
		return 0;
	}

	console.log(
		changedFiles.length > 0
			? `Normalized ${changedFiles.length} Markdown file(s).`
			: `No Markdown changes needed across ${targets.length} file(s).`,
	);
	return 0;
}

if (process.argv[1] === __filename) {
	const exitCode = await runCli();
	process.exit(exitCode);
}
