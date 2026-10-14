import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => { assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Complete package object required'); return value as Row; };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function bytes(path: string): Buffer {
 assert.equal(realpathSync(path), resolve(path), 'Redirected build input denied');
 const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
 try { assert.ok(lstatSync(path).isFile(), 'Regular build input required'); return readFileSync(fd); } finally { closeSync(fd); }
}
function native(command: string, args: string[], cwd: string): string {
 const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
 assert.ok(!result.error && result.signal === null && result.status === 0, `Exact SDK archive command failed (${command}, status ${result.status}, signal ${result.signal}): ${result.stderr}\n${result.stdout}`);
 return result.stdout;
}
const safe = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && !isAbsolute(path)
 && !/[\r\n\0]/u.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\'));

/** Replace only the exact SDK input. Root npm install would resolve unrelated
 * ranged dependencies again and change the CLI's bundled runtime bytes. */
export function hydrateExactSdk(archive: string, expectedSha256: string, root = process.cwd()): void {
 assert.ok(isAbsolute(archive) && /^[a-f0-9]{64}$/u.test(expectedSha256), 'Explicit exact SDK archive and SHA256 required');
 assert.equal(realpathSync(root), resolve(root), 'Independent source package required');
 const manifestPath = resolve(root, 'package.json'), lockPath = resolve(root, 'package-lock.json');
 const manifestBytes = bytes(manifestPath), lockBytes = bytes(lockPath), manifest = row(JSON.parse(manifestBytes.toString())), lock = row(JSON.parse(lockBytes.toString()));
 assert.equal(manifest.name, '@treeseed/cli');
 const pin = row(manifest.dependencies)['@treeseed/sdk'], packages = row(lock.packages), locked = row(packages['node_modules/@treeseed/sdk']);
 assert.ok(typeof pin === 'string' && pin === locked.version && pin === row(row(packages['']).dependencies)['@treeseed/sdk'], 'Exact published SDK pin must agree with the original lock');
 const target = resolve(root, 'node_modules/@treeseed/sdk');
 assert.equal(realpathSync(target), target, 'SDK workspace/source links denied'); assert.ok(lstatSync(target).isDirectory());
 const original = row(JSON.parse(bytes(join(target, 'package.json')).toString())); assert.equal(original.name, '@treeseed/sdk'); assert.equal(original.version, pin);
 const input = bytes(archive); assert.equal(sha256(input), expectedSha256, 'Held SDK archive changed');
 const temporary = join(dirname(target), '.sdk-input'), previous = join(temporary, 'previous');
 // Existing or interrupted staging is never another writer's cleanup target.
 mkdirSync(temporary, { mode: 0o700 });
 let published = false, moved = false, rollbackFailed = false, originalFailure: unknown;
 try {
  const held = join(temporary, 'held.tgz'); writeFileSync(held, input, { flag: 'wx', mode: 0o600 });
  const records = JSON.parse(native('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', held], root)) as unknown;
  assert.ok(Array.isArray(records) && records.length === 1); const record = row(records[0]);
  assert.equal(record.name, '@treeseed/sdk'); assert.equal(record.version, pin); assert.ok(Array.isArray(record.files) && record.files.length > 0);
  const files = record.files.map(row), paths = files.map(file => file.path);
  assert.ok(paths.every(safe) && new Set(paths).size === paths.length && files.every(file => Number.isSafeInteger(file.size) && Number(file.size) >= 0));
  const members = native('tar', ['--list', '--gzip', '--file', held, '--quoting-style=literal'], root).trimEnd().split('\n');
  const details = native('tar', ['--list', '--verbose', '--numeric-owner', '--gzip', '--file', held, '--quoting-style=literal'], root).trimEnd().split('\n');
  assert.equal(members.length, details.length); assert.equal(new Set(members).size, members.length);
  const regular: string[] = [];
  for (const [index, member] of members.entries()) {
   const directory = member.endsWith('/'), path = directory ? member.slice(0, -1) : member;
   assert.ok(safe(path) && path.split('/')[0] === 'package');
   const fields = details[index]!.trim().split(/\s+/u); assert.equal(fields[0]?.[0], directory ? 'd' : '-');
   assert.ok(!/[sStT]/u.test(fields[0] ?? ''), 'Special archive permissions denied');
   if (!directory) regular.push(member);
  }
  assert.deepEqual(regular.sort(), (paths as string[]).map(path => 'package/' + path).sort(), 'Complete ordinary SDK archive members required');
  native('tar', ['--extract', '--gzip', '--file', held, '--directory', temporary, '--no-same-owner', '--no-same-permissions'], root);
  const prepared = join(temporary, 'package'), packaged = row(JSON.parse(bytes(join(prepared, 'package.json')).toString()));
  assert.equal(packaged.name, '@treeseed/sdk'); assert.equal(packaged.version, pin);
  // The held archive owns its dependency declarations, including new SDK helpers.
  // Resolve them inside SDK staging; CLI's locked peers remain outside this scope.
  for (const file of files) assert.equal(bytes(join(prepared, String(file.path))).length, file.size, 'SDK asset inventory differs from archive');
  if (existsSync(join(target, 'node_modules'))) {
   assert.equal(realpathSync(join(target, 'node_modules')), join(target, 'node_modules'));
   assert.equal(existsSync(join(prepared, 'node_modules')), false, 'A separate SDK dependency closure cannot replace locked inputs');
   cpSync(join(target, 'node_modules'), join(prepared, 'node_modules'), { recursive: true, dereference: false, verbatimSymlinks: true });
  }
  native('npm', ['install', '--prefix', prepared, '--omit=dev', '--ignore-scripts', '--no-save', '--package-lock=false', '--no-audit', '--no-fund'], prepared);
  renameSync(target, previous); moved = true;
  renameSync(prepared, target); published = true;
  native('npm', ['ls', '--all', '--omit=dev', '--json'], root);
  assert.deepEqual(bytes(manifestPath), manifestBytes); assert.deepEqual(bytes(lockPath), lockBytes);
  assert.equal(sha256(bytes(archive)), expectedSha256);
 } catch (failure) {
  originalFailure = failure;
  try {
   if (published) renameSync(target, join(temporary, 'denied'));
   if (moved) renameSync(previous, target);
  } catch (rollback) { rollbackFailed = true; throw new AggregateError([failure, rollback], 'Exact SDK hydration and scoped rollback both failed; original bytes retained in private staging'); }
  throw failure;
 } finally {
  try { if (!rollbackFailed) rmSync(temporary, { recursive: true, force: true }); }
  catch (cleanup) { throw originalFailure ? new AggregateError([originalFailure, cleanup], 'SDK hydration and cleanup failed') : cleanup; }
 }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
 assert.equal(process.argv.length, 4, 'Usage: hydrate-exact-sdk.ts <absolute-archive> <sha256>');
 hydrateExactSdk(process.argv[2]!, process.argv[3]!);
}
