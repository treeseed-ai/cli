import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import ts from 'typescript';

const assets = ['treeseed.package.yaml', 'guarantees/verifiers/golden.verifiers.yaml',
 'tests/acceptance/workday-events.test.ts', 'tests/support/os-custody.ts'];
type Packed = { filename: string; integrity: string; files: Array<{ path: string }> };
const execute = async (command: string, args: string[], cwd = process.cwd()) =>
 (await promisify(execFile)(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).stdout;

test('ships the selected CLI native observation assets without checkout source execution or private imports', async () => {
 const [packed] = JSON.parse(await execute('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'])) as Packed[];
 assert.ok(packed); const paths = new Set(packed.files.map(file => file.path));
 assert.deepEqual(assets.filter(path => !paths.has(path)), []);
 const source = ts.createSourceFile(assets[2]!, readFileSync(assets[2]!, 'utf8'), ts.ScriptTarget.Latest, true);
 const privatePaths: string[] = [];
 const visit = (node: ts.Node) => {
  if (ts.isStringLiteral(node) && /(?:^|\/)src\//u.test(node.text)) privatePaths.push(node.text);
  ts.forEachChild(node, visit);
 };
 visit(source); assert.deepEqual(privatePaths, []);
 assert.equal(existsSync('tests/support/os-custody.mjs'), false);
});

test('native production CLI archive retains exact observation assets and executes its public binary without source or development dependencies', { timeout: 30_000 }, async () => {
 const root = mkdtempSync(resolve(tmpdir(), 'cli-installed-assets-'));
 try {
  const packed: Packed[] = [];
  for (const owner of ['./node_modules/@treeseed/sdk', './node_modules/@treeseed/identity', '.']) {
   const [archive] = JSON.parse(await execute('npm', ['pack', owner, '--ignore-scripts', '--json', '--pack-destination', root])) as Packed[];
   assert.ok(archive); packed.push(archive);
   assert.equal(`sha512-${createHash('sha512').update(readFileSync(resolve(root, archive.filename))).digest('base64')}`, archive.integrity);
  }
  const names = ['@treeseed/sdk', '@treeseed/identity', '@treeseed/cli'];
  const dependencies = Object.fromEntries(packed.map((archive, index) => [names[index]!, `file:${resolve(root, archive.filename)}`]));
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies,
   overrides: { '@treeseed/sdk': '$@treeseed/sdk', '@treeseed/identity': '$@treeseed/identity' } }));
  await execute('npm', ['install', '--prefix', root, '--omit=dev', '--ignore-scripts', '--package-lock=false', '--no-save', '--no-audit', '--no-fund',
   ...packed.map(archive => resolve(root, archive.filename))], root);
  await execute('npm', ['ls', '--all', '--omit=dev', '--json'], root);
  const installed = resolve(root, 'node_modules/@treeseed/cli');
  assert.equal(realpathSync(installed), installed); assert.equal(lstatSync(installed).isSymbolicLink(), false);
  for (const path of ['src', 'node_modules/@treeseed/sdk', 'node_modules/@treeseed/identity']) assert.equal(existsSync(resolve(installed, path)), false, path);
  for (const dependency of ['tsx', 'vitest', '@treeseed/deployment', '@treeseed/ui']) assert.equal(existsSync(resolve(root, 'node_modules', dependency)), false, dependency);
  for (const path of assets) assert.deepEqual(readFileSync(resolve(installed, path)), readFileSync(path), path);
  const manifest = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const binary = resolve(installed, manifest.bin.trsd), bytes = readFileSync(binary);
  const env = { ...process.env, TREESEED_CONFIG_HOME: resolve(root, 'config') }; delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
  const result = await promisify(execFile)(process.execPath, [binary, '--help'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.stderr, ''); assert.match(result.stdout, /trsd/u); assert.deepEqual(readFileSync(binary), bytes);
  for (const archive of packed) assert.equal(`sha512-${createHash('sha512').update(readFileSync(resolve(root, archive.filename))).digest('base64')}`, archive.integrity);
  console.log(JSON.stringify({ archives: packed.map(archive => ({ filename: archive.filename,
   sha256: createHash('sha256').update(readFileSync(resolve(root, archive.filename))).digest('hex') })), installedPublicBinary: 'passed' }));
 } finally { rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false); }
});

test('native workday event cases never execute checkout source or substitute an unbound command', () => {
 const selected = existsSync(assets[2]!) ? assets[2]! : 'tests/unit/command-boundary/observation/workday-events.test.ts';
 const source = readFileSync(selected, 'utf8');
 assert.doesNotMatch(source, /['"]src\/cli\/main\.ts['"]/u);
 assert.doesNotMatch(source, /bound\?\.path\s*\?\?/u);
});
