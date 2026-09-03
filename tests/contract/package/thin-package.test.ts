import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('package has one executable and only its declared CLI runtime dependencies', () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.deepEqual(pkg.bin, { trsd: './dist/cli/main.js' });
	assert.equal(pkg.exports, undefined);
	assert.equal(pkg.types, undefined);
	assert.equal(pkg.files.some((path: string) => path.startsWith('scripts/')), false);
	assert.equal(pkg.dependencies['@treeseed/agent'], undefined);
	assert.deepEqual(pkg.dependencies, { '@treeseed/sdk': '0.13.0-rc.85', ink: '^7.1.1', react: '^19.2.8', 'string-width': '^8.2.2', yaml: '2.9.0' });
	assert.equal(pkg.devDependencies['@treeseed/ui'], '>=0.12.18-rc.12 <0.14.0');
});

test('built package contains executable runtime only', () => {
	assert.equal(existsSync('dist/cli/main.js'), true);
	assert.equal(existsSync('dist/cli/types.js'), false);
	assert.equal(readdirSync('dist', { recursive: true }).some((path) => String(path).endsWith('.d.ts')), false);
});

test('the shared Ink runtime is bundled against the CLI React peer', () => {
	const runtime = readFileSync('dist/cli/application/ui-runtime.js', 'utf8');
	assert.doesNotMatch(runtime, /(?:from\s*|require\()["']@treeseed\/ui(?:\/ink)?["']/u);
	assert.match(runtime, /from\s*["']react["']/u);
	assert.match(runtime, /from\s*["']ink["']/u);
});

test('the integrated shell accepts deterministic shared development scenes', () => {
	const runtime = readFileSync('src/cli/runtime.ts', 'utf8');
	const help = readFileSync('src/cli/help.ts', 'utf8');
	assert.match(runtime, /resolveDevelopmentScene\(sceneId\)/u);
	assert.match(runtime, /scene\?\.workspace/u);
	assert.match(runtime, /scene\?\.surface/u);
	assert.match(runtime, /development_scene_unknown/u);
	assert.match(help, /trsd ui --scene <scene>/u);
});

test('the executable drains complete output before exiting', () => {
	const main = readFileSync('src/cli/main.ts', 'utf8');
	assert.equal(main.includes('process.exit('), false);
	assert.equal(main.includes('process.exitCode = await runCommandLine'), true);
});

test('candidate promotion installs the exact registry SDK without lifecycle builds', () => {
	const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
	const install = workflow.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
	const verify = workflow.indexOf('npm run release:custody -- verify');
	assert.equal(workflow.includes('hydrate-exact-sdk.sh'), false);
	assert.ok(install >= 0 && verify > install);
});

test('source contains no legacy implementation residue', () => {
	const walk = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${root}/${entry.name}`) : [`${root}/${entry.name}`]);
	const files = walk('src').join('\n');
	for (const forbidden of ['handlers/capacity', 'workspace-lifecycle', 'handlers/hosting', 'handlers/treedx', 'handlers/scenes', 'handlers/seeds', 'handlers/agents']) assert.equal(files.includes(forbidden), false, forbidden);
	const sourceFiles = walk('src');
	const source = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
	for (const forbidden of ['MarketClient', 'marketId', '--market', 'operator/commands', 'workflow-support']) assert.equal(source.includes(forbidden), false, forbidden);
	const nonHostTransport = sourceFiles.filter((file) => !file.endsWith('/host-client.ts')).map((file) => readFileSync(file, 'utf8')).join('\n');
	assert.equal(nonHostTransport.includes('/v1/'), false, '/v1/ outside the fixed host-manager transport');
	for (const removed of ['docs/src', 'guarantees', '.gitmodules']) assert.equal(existsSync(removed), false, removed);
});
