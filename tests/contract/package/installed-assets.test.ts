import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import ts from 'typescript';

const assets = ['treeseed.package.yaml', 'guarantees/verifiers/golden.verifiers.yaml',
 'tests/acceptance/workday-events.test.ts', 'tests/support/os-custody.ts', 'tests/support/native-loader.ts'];
type Packed = { name:string; filename: string; integrity: string; files: Array<{ path: string }> };
const execute = async (command: string, args: string[], cwd = process.cwd()) =>
 (await promisify(execFile)(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).stdout;

test('ships the selected CLI native observation assets without checkout source execution or private imports', async () => {
 const [packed] = JSON.parse(await execute('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'])) as Packed[];
 assert.ok(packed); const paths = new Set(packed.files.map(file => file.path));
 assert.deepEqual(assets.filter(path => !paths.has(path)), []);
 const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
 for (const path of ['dist/.treeseed-build-complete.json', 'dist/.treeseed-build-complete.json.new']) {
  assert.ok(manifest.files.includes(`!${path}`), 'Development readiness bytes must be excluded from package selection');
  assert.equal(paths.has(path), false);
 }
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
  const names = ['@treeseed/sdk', '@treeseed/identity', '@treeseed/cli'];
  const sdkInput=process.env.TREESEED_TEST_SDK_ARCHIVE,sdkDigest=process.env.TREESEED_TEST_SDK_ARCHIVE_SHA256;
  assert.ok(sdkInput&&sdkDigest,'Reuse the exact held SDK archive instead of repacking its installed files');assert.equal(isAbsolute(sdkInput),true);
  assert.equal(lstatSync(sdkInput).isSymbolicLink(),false);assert.equal(createHash('sha256').update(readFileSync(sdkInput)).digest('hex'),sdkDigest);
  const [sdkInventory,ownerInventory]=await Promise.all([
   execute('npm',['pack','--dry-run','--ignore-scripts','--json',sdkInput]),
   execute('npm',['pack','./node_modules/@treeseed/identity','.', '--ignore-scripts','--json','--pack-destination',root]),
  ]);
  const [sdk]=JSON.parse(sdkInventory) as Packed[];
  assert.ok(sdk);assert.equal(sdk.name,'@treeseed/sdk');copyFileSync(sdkInput,resolve(root,sdk.filename));
  const records=[sdk,...JSON.parse(ownerInventory) as Packed[]];
  assert.equal(records.length,names.length);
  const packed=names.map(name=>{const matches=records.filter(record=>record.name===name);assert.equal(matches.length,1);return matches[0]!;});
  for (const archive of packed) {
   assert.equal(`sha512-${createHash('sha512').update(readFileSync(resolve(root, archive.filename))).digest('base64')}`, archive.integrity);
  }
  const dependencies = Object.fromEntries(packed.map((archive, index) => [names[index]!, `file:${resolve(root, archive.filename)}`]));
  const verifierArchive=process.env.TREESEED_TEST_REVIEWER_ARCHIVE,verifierDigest=process.env.TREESEED_TEST_REVIEWER_ARCHIVE_SHA256;
  assert.ok(verifierArchive&&verifierDigest,'The exact production Reviewer archive must be supplied for native verifier closure');
  assert.equal(isAbsolute(verifierArchive),true);
  assert.equal(lstatSync(verifierArchive).isSymbolicLink(),false);
  assert.equal(createHash('sha256').update(readFileSync(verifierArchive)).digest('hex'),verifierDigest);
  const verifierInput=resolve(root,basename(verifierArchive));assert.equal(existsSync(verifierInput),false);copyFileSync(verifierArchive,verifierInput);
  writeFileSync(resolve(root,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{...dependencies,'@treeseed/reviewer':`file:${verifierInput}`},
   overrides:{'@treeseed/sdk':'$@treeseed/sdk','@treeseed/identity':'$@treeseed/identity'}}));
  await execute('npm',['install','--prefix',root,'--omit=dev','--ignore-scripts','--package-lock=false','--no-save','--no-audit','--no-fund','--prefer-offline','--install-strategy=nested',
   ...packed.map(archive=>resolve(root,archive.filename)),verifierInput],root);
  await execute('npm', ['ls', '--all', '--omit=dev', '--json'], root);
  const installed = resolve(root, 'node_modules/@treeseed/cli');
  assert.equal(realpathSync(installed), installed); assert.equal(lstatSync(installed).isSymbolicLink(), false);
  for (const path of ['dist/.treeseed-build-complete.json', 'dist/.treeseed-build-complete.json.new'])
   assert.equal(existsSync(resolve(installed, path)), false, 'Installed archives must omit development readiness state');
  for (const path of ['src', 'node_modules/@treeseed/sdk', 'node_modules/@treeseed/identity']) assert.equal(existsSync(resolve(installed, path)), false, path);
  for (const dependency of ['tsx', 'vitest', '@treeseed/deployment', '@treeseed/ui']) assert.equal(existsSync(resolve(root, 'node_modules', dependency)), false, dependency);
  for (const path of assets) assert.deepEqual(readFileSync(resolve(installed, path)), readFileSync(path), path);
  const manifest = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin.trsd, './dist/cli/main.js'); const binary = resolve(installed, manifest.bin.trsd), bytes = readFileSync(binary);
  const env: NodeJS.ProcessEnv = { ...process.env, TREESEED_CONFIG_HOME: resolve(root, 'config') }; delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
  const verifierRoot=resolve(root,'node_modules/@treeseed/reviewer');
  const verifierManifest=JSON.parse(readFileSync(resolve(verifierRoot,'package.json'),'utf8'));
  assert.equal(verifierManifest.name,'@treeseed/reviewer');assert.ok(verifierManifest.dependencies.tsx);
  assert.equal(existsSync(resolve(root,'node_modules/tsx')),false,'CLI must not obtain a hoisted undeclared loader');
  const runner=resolve(verifierRoot,'dist/verifiers/guarantees/node-case.js'),asset=resolve(installed,assets[2]!),helper=resolve(installed,assets[4]!);
  const helperBytes=readFileSync(helper);rmSync(helper);
  const invocation=[runner,asset,'packaged native workday diagnostic readback preserves exact clock bytes and denied history through unchanged retry without execution requests',resolve(root,'node_modules')];
  let denied='';try{await promisify(execFile)(process.execPath,invocation,{cwd:installed,env,encoding:'utf8'});assert.fail('Missing archived loader helper must deny');}
  catch(error){denied=String((error as {stdout?:string}).stdout??'');assert.equal(JSON.parse(denied).success,false);}
  writeFileSync(helper,helperBytes);
  // The public-binary/readiness checks and original installed diagnostic case
  // read the same immutable executable bytes and use separate temporary config.
  // Wait for both outcomes before cleanup, including when either fails.
  const outcomes=await Promise.allSettled([
   promisify(execFile)(process.execPath,invocation,{cwd:installed,env,encoding:'utf8'}),
   (async()=>{
  const result = await promisify(execFile)(process.execPath, [binary, '--help'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.stderr, ''); assert.match(result.stdout, /trsd/u); assert.deepEqual(readFileSync(binary), bytes);
  const alias = resolve(root, 'trsd'), replacement = resolve(root, 'replacement.ts'), preload = resolve(root, 'switch-entrypoint.mts');
  symlinkSync(binary, alias); writeFileSync(replacement, bytes);
  writeFileSync(preload, `import{registerHooks}from'node:module';import{unlinkSync,symlinkSync,writeFileSync}from'node:fs';import{pathToFileURL}from'node:url';
registerHooks({resolve(specifier,context,next){if(context.parentURL===pathToFileURL(${JSON.stringify(binary)}).href&&specifier==='./runtime.js'){
unlinkSync(${JSON.stringify(alias)});symlinkSync(${JSON.stringify(replacement)},${JSON.stringify(alias)});writeFileSync(${JSON.stringify(resolve(root,'switched'))},'observed');}return next(specifier,context);}});`);
  const switched = await promisify(execFile)(process.execPath, ['--import', preload, alias, '--help'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(readFileSync(resolve(root, 'switched'), 'utf8'), 'observed');
  assert.equal(switched.stderr, ''); assert.match(switched.stdout, /trsd/u, 'The loaded public binary must finish even when its invocation symlink moves');
  assert.deepEqual(readFileSync(binary), bytes);
  const inventory = async () => (JSON.parse(await execute('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], installed)) as Packed[])[0]!;
  const before = await inventory();
  for (const path of ['dist/.treeseed-build-complete.json', 'dist/.treeseed-build-complete.json.new'])
   writeFileSync(resolve(installed, path), JSON.stringify({ completedAt: new Date().toISOString(), executable: 'cli/main.js' }));
  const after = await inventory();
  assert.equal(after.integrity, before.integrity, 'Development readiness changes must not change executable archive custody');
  assert.deepEqual(after.files, before.files); assert.deepEqual(readFileSync(binary), bytes);
   })(),
  ]);
  for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
  const observed=outcomes[0]!;assert.equal(observed.status,'fulfilled');
  const native=JSON.parse(observed.value.stdout);
  assert.equal(native.success,true);assert.equal(native.numPassedTests,1);assert.equal(native.numFailedTests,0);
  assert.equal(createHash('sha256').update(readFileSync(verifierInput)).digest('hex'),verifierDigest);
  assert.deepEqual(readFileSync(helper),helperBytes);assert.equal(JSON.parse(denied).success,false);
  for (const archive of packed) assert.equal(`sha512-${createHash('sha512').update(readFileSync(resolve(root, archive.filename))).digest('base64')}`, archive.integrity);
  assert.equal(createHash('sha256').update(readFileSync(sdkInput)).digest('hex'),sdkDigest);
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
