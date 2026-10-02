import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

test('package has one executable and only its declared CLI runtime dependencies', () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.deepEqual(pkg.bin, { trsd: './dist/cli/main.js' });
	assert.equal(pkg.exports, undefined);
	assert.equal(pkg.types, undefined);
	assert.equal(pkg.files.some((path: string) => path.startsWith('scripts/')), false);
	assert.equal(pkg.dependencies['@treeseed/agent'], undefined);
	assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@treeseed/identity','@treeseed/sdk','ink','react','string-width','yaml']);
	assert.match(pkg.dependencies['@treeseed/identity'], /^0\.1\.0-rc\.\d+$/);
	assert.match(pkg.dependencies['@treeseed/sdk'], /^0\.13\.0-rc\.\d+$/);
	assert.match(pkg.devDependencies['@treeseed/deployment'], /^https:\/\/github\.com\/treeseed-ai\/deployment\/releases\/download\/0\.1\.0-rc\.\d+\/treeseed-deployment-runtime-0\.1\.0-rc\.\d+\.tgz$/);
	assert.equal(pkg.devDependencies['@treeseed/ui'], '>=0.12.18-rc.12 <0.14.0');
});

test('built package contains executable runtime only', () => {
	const custody = readFileSync('dist/cli/support/server-custody.js', 'utf8');
	assert.doesNotMatch(custody, /from\s*["']@treeseed\/deployment/u);
	assert.match(custody, /systemd-creds/u);
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

test('candidate promotion uses staging while stable publication uses production', () => {
	const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
	const install = workflow.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
	const verify = workflow.indexOf('npm run release:custody -- verify');
	assert.equal(workflow.includes('hydrate-exact-sdk.sh'), false);
	assert.ok(install >= 0 && verify > install);
	assert.match(workflow, /environment: \$\{\{ contains\(github\.ref_name, '-'\) && 'staging' \|\| 'production' \}\}/u);
	assert.match(workflow, /candidate_branch=staging; else candidate_branch=main/u);
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
	for (const removed of ['docs/src', '.gitmodules']) assert.equal(existsSync(removed), false, removed);
});

test('guarantee metadata binds owner tests without adding a second CLI implementation', () => {
	const reporting: Record<string,{testFile:string;testName:string}> = {
		'cli.golden.source-files': {testFile:'tests/unit/source-custody.test.ts',testName:'complete CLI source is readable owner files without undeclared external Git links'},
		'cli.golden.source-checkout': {testFile:'tests/integration/source-custody.test.ts',testName:'fresh native Git checkout materializes every CLI source entry without missing-directory sentinels'},
		'cli.golden.sdk-agreement': {testFile:'tests/unit/dependency-sbom.test.ts',testName:'exact SDK artifact agrees with both dependency declarations before acceptance'},
		'cli.golden.sbom-authority': {testFile:'tests/unit/dependency-sbom.test.ts',testName:'strict SBOM is generated once by release verification before tests and candidate sealing'},
		'cli.golden.sbom-native': {testFile:'tests/integration/dependency-sbom.test.ts',testName:'strict native SBOM accepts exact installed artifacts and refuses mismatched missing malformed dependencies'},
		'cli.golden.workflow-triggers': {testFile:'tests/contract/package/thin-package.test.ts',testName:'verification retains every PR protected branch and tag without duplicate topic pushes'},
		'cli.golden.reporting-deadlines': {testFile:'tests/unit/native-suite-reporting.test.ts',testName:'native reporting cannot replace original suite deadlines or interrupt policy through reporting flags'},
		'cli.golden.native-reporting': {testFile:'tests/integration/native-suite-reporting.test.ts',testName:'native complete reporting preserves build discovery custody and nested subprocess defaults'},
		'cli.golden.reporting-denial': {testFile:'tests/integration/native-suite-reporting.test.ts',testName:'native reporter arguments reject filters unknown flags and malformed pairs before test side effects'},
		'cli.golden.reporting-outcomes': {testFile:'tests/integration/native-suite-reporting.test.ts',testName:'native reporting retains failed skipped todo empty and crashed suite outcomes'},
		'cli.golden.reporting-unit': {testFile:'tests/unit/native-suite-reporting.test.ts',testName:'native reporting accepts only a complete nonempty reporting pair without test selection'},
	};
	const observedReporting = new Set<string>();
	const files = readdirSync('guarantees', { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
	assert.equal(files.length, 3);
	for (const entry of files) {
		assert.match(entry.name, /\.yaml$/u);
		const document = parse(readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'));
		assert.match(document.schemaVersion, /^treeseed\.(guarantee|scene|guarantee-verifiers)\/v1$/u);
		if (document.verifiers) for (const [ref,verifier] of Object.entries(document.verifiers) as Array<[string,{kind: string; ownerPackage: string; testFile: string;testName:string}]>) {
			assert.equal(verifier.kind, 'nodeTestCase');
			assert.equal(verifier.ownerPackage, '@treeseed/cli');
			if (Object.hasOwn(reporting,ref)) {
				assert.deepEqual({testFile:verifier.testFile,testName:verifier.testName},reporting[ref]);
				observedReporting.add(ref);
			} else assert.match(verifier.testFile, /^tests\/unit\/command-boundary\//u);
			assert.equal(existsSync(verifier.testFile), true);
		}
	}
	assert.deepEqual([...observedReporting].sort(),Object.keys(reporting).sort());
});

test('verification retains every PR protected branch and tag without duplicate topic pushes',()=>{
	const workflow=parse(readFileSync('.github/workflows/verify.yml','utf8'));
	assert.deepEqual(workflow.on.push.branches,['staging','main']);
	assert.deepEqual(workflow.on.push.tags,['**']);
	assert.deepEqual(workflow.on.push['paths-ignore'],['docs/src/content/**']);
	assert.deepEqual(workflow.on.pull_request['paths-ignore'],['docs/src/content/**']);
	assert.equal(Object.hasOwn(workflow.on,'workflow_dispatch'),true);
});
