import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { packageRoot } from './package-tools.ts';

const srcRoot = resolve(packageRoot, 'src');
const distRoot = resolve(packageRoot, 'dist');

function walkFiles(root) {
	const files = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

const publishableSourceFiles = walkFiles(srcRoot).filter((filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.d.ts'));

function ensureDir(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function rewriteRuntimeSpecifiers(contents) {
	return contents.replace(/(['"`])(\.[^'"`\n]+)\.(mjs|ts)\1/g, '$1$2.js$1');
}

async function compileModule(filePath) {
	const outputFile = resolve(distRoot, relative(srcRoot, filePath).replace(/\.ts$/u, '.js'));
	ensureDir(outputFile);
	await build({
		entryPoints: [filePath],
		outfile: outputFile,
		platform: 'node',
		format: 'esm',
		bundle: false,
		logLevel: 'silent',
	});
	writeFileSync(outputFile, rewriteRuntimeSpecifiers(readFileSync(outputFile, 'utf8')), 'utf8');
}

function emitDeclarations() {
	const program = ts.createProgram({
		rootNames: publishableSourceFiles,
		options: {
			allowImportingTsExtensions: true,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			strict: true,
			noEmit: false,
			declaration: true,
			emitDeclarationOnly: true,
			declarationDir: distRoot,
			types: ['node'],
		},
	});
	const result = program.emit();
	if (result.emitSkipped) {
		const diagnostics = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
			getCanonicalFileName: (fileName) => fileName,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => '\n',
		});
		throw new Error(`Declaration build failed.\n${diagnostics}`);
	}
}

rmSync(distRoot, { recursive: true, force: true });

for (const filePath of publishableSourceFiles) {
	await compileModule(filePath);
}

emitDeclarations();

if (existsSync(resolve(packageRoot, 'README.md'))) {
	copyFileSync(resolve(packageRoot, 'README.md'), resolve(distRoot, '..', 'README.md'));
}
